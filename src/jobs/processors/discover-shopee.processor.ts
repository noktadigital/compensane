import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@/database/prisma.service';
import { ProductsService } from '@/products/products.service';
import { SHOPEE_ADAPTER } from '@/marketplaces/shopee/shopee.module';
import {
  MarketplaceAdapter,
  RawMarketplaceOffer,
} from '@/marketplaces/core/marketplace-adapter.interface';
import { OfferQualityService } from '@/deals/offer-quality.service';
import { DiscordClientService } from '@/discord/discord-client.service';
import { PriceReferenceService } from '@/price-history/price-reference.service';
import { PriceRecordingService } from '@/price-history/price-recording.service';
import { AppConfigService } from '@/config/app-config.service';
import { LOW_COST_WORKER_OPTIONS } from '../worker-options';

export const QUEUE_DISCOVER_SHOPEE = 'discover-shopee';
export const JOB_DISCOVER_KEYWORD = 'discover-keyword';

/** Teto de cards por execucao, para nao inundar o canal de aprovacao. */
const MAX_CARDS_POR_CICLO = 60;

/**
 * Pausa entre cards.
 *
 * O limite do Discord e ~5 mensagens por 5s por canal, e o discord.js ja
 * aguarda sozinho quando bate no 429 — medido: rajada de 10 levou 8s, com
 * uma espera automatica de 4,4s na setima. Nao ha risco de ban por isso
 * (ban vem de abuso persistente de API, nao de mensagens legitimas).
 *
 * 1,2s mantem o envio abaixo do teto sem depender do 429, e faz um ciclo
 * cheio de 60 cards levar ~1min em vez de bloquear no meio.
 */
const PAUSA_ENTRE_CARDS_MS = 1200;

/**
 * Descoberta de ofertas (secao 21).
 *
 * Varre as CATEGORIAS do marketplace (nao palavras-chave) e, para cada
 * produto encontrado, decide duas coisas separadas:
 *
 *   1. vale monitorar? -> grava Product/ProductOffer e passa a acompanhar o
 *      preco. Produto sem nenhuma venda nao entra: guardar serie de preco de
 *      item que ninguem compra so infla o banco e gasta chamada de API.
 *
 *   2. vale publicar AGORA? -> manda o card para aprovacao no Discord, ja com
 *      link de afiliado pronto.
 *
 * A checagem anti-fraude (OfferQualityService) nao depende de historico
 * proprio: desconto implausivel, ausencia de vendas e faixa de preco larga
 * sao detectaveis na hora. O historico proprio continua sendo coletado e
 * entra depois como confirmacao ou desmentido no card.
 */
@Processor(QUEUE_DISCOVER_SHOPEE, { concurrency: 1, ...LOW_COST_WORKER_OPTIONS })
export class DiscoverShopeeProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoverShopeeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly quality: OfferQualityService,
    private readonly discord: DiscordClientService,
    private readonly priceReference: PriceReferenceService,
    private readonly priceRecording: PriceRecordingService,
    private readonly appConfig: AppConfigService,
    @Inject(SHOPEE_ADAPTER) private readonly shopeeAdapter: MarketplaceAdapter,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ monitoradas: number; publicadas: number }> {
    const categorias = this.shopeeAdapter.listCategories
      ? await this.shopeeAdapter.listCategories()
      : [];

    if (categorias.length === 0) {
      this.logger.warn('Adapter nao expoe categorias — descoberta pulada.');
      return { monitoradas: 0, publicadas: 0 };
    }

    this.logger.log(`Varrendo ${categorias.length} categorias da Shopee.`);

    const candidatas: RawMarketplaceOffer[] = [];
    let monitoradas = 0;
    let descartadas = 0;

    for (const categoria of categorias) {
      let ofertas: RawMarketplaceOffer[] = [];

      try {
        ofertas = this.shopeeAdapter.browseCategory
          ? await this.shopeeAdapter.browseCategory({ categoryId: categoria.id, pageSize: 50 })
          : [];
      } catch (error) {
        // Uma categoria que falha nao pode derrubar a varredura inteira.
        this.logger.warn(
          `Categoria "${categoria.name}" falhou: ${(error as Error).message}`,
        );
        continue;
      }

      for (const raw of ofertas) {
        const veredito = this.quality.avaliar(raw);

        if (!veredito.valeMonitorar) {
          descartadas++;
          continue;
        }

        const offer = await this.productsService.upsertFromRawOffer(raw);

        // Grava o preco JUNTO da descoberta. Sem isto a oferta nascia com
        // lastCollectedAt preenchido mas sem nenhuma observacao — e ficava
        // invisivel para o carry-forward, que nao tem preco para carregar.
        // Eram 504 ofertas num unico ciclo presas nesse limbo.
        await this.priceRecording.recordObservation(offer.id, raw);
        monitoradas++;

        if (veredito.valePublicar) {
          candidatas.push(raw);
        }
      }
    }

    // As melhores primeiro: desconto e o que interessa para a audiencia.
    candidatas.sort((a, b) => (b.discountRate ?? 0) - (a.discountRate ?? 0));
    const selecionadas = candidatas.slice(0, MAX_CARDS_POR_CICLO);

    let publicadas = 0;
    for (const raw of selecionadas) {
      if (await this.publicar(raw)) {
        publicadas++;
        await new Promise((r) => setTimeout(r, PAUSA_ENTRE_CARDS_MS));
      }
    }

    this.logger.log(
      `Descoberta concluida: ${monitoradas} monitoradas, ${descartadas} descartadas (sem vendas), ` +
        `${publicadas} enviadas ao Discord de ${candidatas.length} aprovadas.`,
    );

    return { monitoradas, publicadas };
  }

  /**
   * Desconto REAL: preco atual contra o preco de referencia do nosso proprio
   * historico. Retorna null enquanto a serie for curta demais para sustentar
   * a afirmacao — e melhor nao alegar medicao do que alegar uma fraca.
   *
   * Sao necessarios pelo menos 3 dias distintos: com 1 ou 2 pontos, a
   * referencia tende a ser o proprio preco atual e o resultado seria sempre
   * ~0%, o que nao informa nada.
   */
  private async descontoRealMedido(
    productOfferId: string,
    precoAtualCents: number,
  ): Promise<number | null> {
    const MIN_DIAS = 3;

    const dias = await this.prisma.dailyPriceAggregate.count({ where: { productOfferId } });
    if (dias < MIN_DIAS) {
      return null;
    }

    const referencia = await this.priceReference.computeReferencePrice(
      productOfferId,
      precoAtualCents,
    );

    if (referencia.method === 'current_price' || referencia.referencePriceCents <= 0) {
      return null;
    }

    const desconto =
      (referencia.referencePriceCents - precoAtualCents) / referencia.referencePriceCents;

    return desconto > 0 ? desconto : 0;
  }

  /** Envia o card de aprovacao com link de afiliado pronto. */
  private async publicar(raw: RawMarketplaceOffer): Promise<boolean> {
    try {
      const offer = await this.prisma.productOffer.findUnique({
        where: {
          marketplace_externalId: { marketplace: raw.marketplace, externalId: raw.externalId },
        },
        include: { product: { select: { title: true } } },
      });

      if (!offer) {
        return false;
      }

      // Nao repetir card da mesma oferta — EXCETO se o preco caiu desde o
      // ultimo envio. "Ficou mais barato do que quando eu mandei" e
      // justamente o alerta que vale repetir.
      const ultimo = await this.prisma.deal.findFirst({
        where: { productOfferId: offer.id },
        orderBy: { detectedAt: 'desc' },
        select: { id: true, priceCents: true, detectedAt: true, status: true },
      });

      const QUEDA_MINIMA_PARA_REPOSTAR = 0.05;
      let quedaDesdeUltimoEnvio: number | null = null;

      if (ultimo) {
        const caiu = (ultimo.priceCents - raw.priceCents) / ultimo.priceCents;
        const dentroDaJanela =
          ultimo.detectedAt.getTime() > Date.now() - 72 * 60 * 60 * 1000;

        if (caiu >= QUEDA_MINIMA_PARA_REPOSTAR) {
          quedaDesdeUltimoEnvio = caiu;
        } else if (dentroDaJanela) {
          return false;
        }
      }

      const veredito = this.quality.avaliar(raw);
      const anunciado = raw.discountRate ?? 0;

      // Desconto REAL medido contra o nosso proprio historico. No dia zero a
      // serie nao sustenta nada e isto fica null — o card sai so com o
      // numero da loja. Conforme o historico cresce, este valor passa a
      // existir e o confronto anunciado vs. real volta a funcionar sozinho.
      const real = await this.descontoRealMedido(offer.id, raw.priceCents);
      const desconto = real ?? anunciado;

      const deal = await this.prisma.deal.create({
        data: {
          productOfferId: offer.id,
          status: 'DETECTED',
          // Sem historico proprio ainda: o score reflete o desconto anunciado
          // ja filtrado pelo anti-fraude, nao uma medicao nossa.
          dealScore: Math.min(100, Math.round(desconto * 100)),
          confidenceScore: real != null ? 1 : 0,
          priceCents: raw.priceCents,
          referencePriceCents: raw.originalPriceCents ?? raw.priceCents,
          discountRate: desconto,
          commissionCents: raw.commissionCents ?? null,
          freeShipping: raw.freeShipping ?? false,
          preHikeDetected: false,
          scoreBreakdown: {
            origem: 'descoberta-por-categoria',
            descontoAnunciado: anunciado,
            descontoRealMedido: real,
            quedaDesdeUltimoEnvio,
            alertas: veredito.alertas,
          },
        },
      });

      const link = await this.shopeeAdapter.generateAffiliateLink(raw);
      const stored = await this.prisma.affiliateLink.create({
        data: {
          dealId: deal.id,
          productOfferId: offer.id,
          originalLink: link.originalLink,
          shortLink: link.shortLink,
          subId: link.subId,
        },
      });

      await this.discord.sendDealCard(
        deal.id,
        {
          title: offer.product.title,
          priceCents: raw.priceCents,
          originalPriceCents: raw.originalPriceCents,
          // Os dois lados do confronto: o que a loja diz e o que medimos.
          // Quando ainda nao ha historico, `real` e null e o card mostra
          // apenas o numero da loja, sem alegar medicao que nao existe.
          discountRate: real ?? anunciado,
          advertisedDiscountRate: anunciado,
          precoUltimoEnvioCents: quedaDesdeUltimoEnvio != null ? ultimo?.priceCents : null,
          freeShipping: raw.freeShipping,
          link: `${this.appConfig.appUrl}/r/${stored.id}`,
          ratingStar: raw.ratingStar,
          salesCount: raw.salesCount,
          dealScore: deal.dealScore,
          commissionCents: raw.commissionCents,
          alertas: veredito.alertas,
        },
        raw.imageUrl,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao publicar oferta ${raw.externalId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
