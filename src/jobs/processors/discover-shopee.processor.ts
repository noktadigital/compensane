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
import { AppConfigService } from '@/config/app-config.service';
import { LOW_COST_WORKER_OPTIONS } from '../worker-options';

export const QUEUE_DISCOVER_SHOPEE = 'discover-shopee';
export const JOB_DISCOVER_KEYWORD = 'discover-keyword';

/** Teto de cards por execucao, para nao inundar o canal de aprovacao. */
const MAX_CARDS_POR_CICLO = 60;

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

        await this.productsService.upsertFromRawOffer(raw);
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
      }
    }

    this.logger.log(
      `Descoberta concluida: ${monitoradas} monitoradas, ${descartadas} descartadas (sem vendas), ` +
        `${publicadas} enviadas ao Discord de ${candidatas.length} aprovadas.`,
    );

    return { monitoradas, publicadas };
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

      // Nao repetir card da mesma oferta enquanto ela ainda estiver em cartaz.
      const jaEnviada = await this.prisma.deal.findFirst({
        where: {
          productOfferId: offer.id,
          detectedAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });

      if (jaEnviada) {
        return false;
      }

      const veredito = this.quality.avaliar(raw);
      const desconto = raw.discountRate ?? 0;

      const deal = await this.prisma.deal.create({
        data: {
          productOfferId: offer.id,
          status: 'DETECTED',
          // Sem historico proprio ainda: o score reflete o desconto anunciado
          // ja filtrado pelo anti-fraude, nao uma medicao nossa.
          dealScore: Math.min(100, Math.round(desconto * 100)),
          confidenceScore: 0,
          priceCents: raw.priceCents,
          referencePriceCents: raw.originalPriceCents ?? raw.priceCents,
          discountRate: desconto,
          commissionCents: raw.commissionCents ?? null,
          freeShipping: raw.freeShipping ?? false,
          preHikeDetected: false,
          scoreBreakdown: { origem: 'descoberta-por-categoria', alertas: veredito.alertas },
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
          discountRate: desconto,
          advertisedDiscountRate: desconto,
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
