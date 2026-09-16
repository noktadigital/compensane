import { Injectable } from '@nestjs/common';
import { DecisionType } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { PriceReferenceService } from '@/price-history/price-reference.service';

export interface OfferHistoryPoint {
  dia: string;
  fechamento: number;
  minimo: number;
  maximo: number;
  /** 0 = dia sem observacao nova (preco carregado do dia anterior). */
  observacoes: number;
}

export interface OfferHistory {
  id: string;
  externalId: string;
  titulo: string;
  url: string;
  imagem: string | null;
  loja: string | null;
  precoAtualCents: number;
  referenciaCents: number;
  metodoReferencia: string;
  descontoReal: number;
  minimoCents: number;
  maximoCents: number;
  diasHistorico: number;
  serie: OfferHistoryPoint[];
}

export interface OfferListItem {
  id: string;
  titulo: string;
  /** URL do produto no marketplace — para abrir a pagina real da oferta. */
  url: string;
  precoAtualCents: number;
  minimoCents: number;
  maximoCents: number;
  diasHistorico: number;
  descontoReal: number;
  ultimaColeta: string | null;
  /** Ja foi aprovado e enviado ao grupo alguma vez? */
  jaEnviado: boolean;
  /** Quando foi enviado pela ultima vez (ISO), se ja foi. */
  enviadoEm: string | null;
}

/** Oferta que ja foi aprovada e teve link gerado — ou seja, ja foi ao grupo. */
export interface PublishedItem {
  dealId: string;
  offerId: string;
  titulo: string;
  precoCents: number;
  enviadoEm: string;
  enviadoPor: string | null;
  link: string | null;
  cliques: number;
  /** Dias desde o envio — ajuda a decidir se ja pode repostar. */
  diasAtras: number;
}

/**
 * Consultas de leitura do historico de precos. Separado dos services de
 * escrita (PriceRecordingService/PriceAggregationService) porque responde a
 * uma pergunta diferente: nao "o que gravar", mas "o que foi gravado".
 */
@Injectable()
export class PriceHistoryQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceReference: PriceReferenceService,
  ) {}

  /** Ofertas monitoradas, das que tem mais historico para as que tem menos. */
  async listOffers(limit = 100): Promise<OfferListItem[]> {
    const offers = await this.prisma.productOffer.findMany({
      // Exclui ofertas de demonstracao (backfill-demo-history.ts): o historico
      // delas e fabricado e contamina qualquer leitura do painel.
      where: { active: true, externalId: { not: { contains: 'mock' } } },
      include: {
        product: { select: { title: true } },
        dailyPriceAggregates: { orderBy: { day: 'desc' }, take: 90 },
        // Aprovacoes desta oferta: e o que responde "ja mandei no grupo?".
        deals: {
          where: { decisions: { some: { decision: DecisionType.APPROVE } } },
          orderBy: { publishedAt: 'desc' },
          take: 1,
          select: { publishedAt: true },
        },
      },
      take: limit,
    });

    return offers
      .map((offer) => {
        const aggs = offer.dailyPriceAggregates;
        const atual = aggs[0]?.closePriceCents ?? 0;
        const minimo = aggs.length ? Math.min(...aggs.map((a) => a.minPriceCents)) : 0;
        const maximo = aggs.length ? Math.max(...aggs.map((a) => a.maxPriceCents)) : 0;
        const mediana = this.mediana(aggs.map((a) => a.closePriceCents));
        const enviado = offer.deals[0]?.publishedAt ?? null;

        return {
          id: offer.id,
          titulo: offer.product.title,
          url: offer.url,
          precoAtualCents: atual,
          minimoCents: minimo,
          maximoCents: maximo,
          diasHistorico: aggs.length,
          descontoReal: mediana > 0 ? (mediana - atual) / mediana : 0,
          ultimaColeta: offer.lastCollectedAt?.toISOString() ?? null,
          jaEnviado: offer.deals.length > 0,
          enviadoEm: enviado?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.diasHistorico - a.diasHistorico || b.descontoReal - a.descontoReal);
  }

  /**
   * Tudo que ja foi aprovado e foi para o grupo, do mais recente para o mais
   * antigo. Existe porque nao da para lembrar de centenas de produtos: sem
   * isso, a unica forma de nao repetir post era memoria.
   */
  async listPublished(limit = 100): Promise<PublishedItem[]> {
    const decisoes = await this.prisma.dealDecision.findMany({
      where: { decision: DecisionType.APPROVE },
      orderBy: { decidedAt: 'desc' },
      take: limit,
      include: {
        deal: {
          include: {
            productOffer: { include: { product: { select: { title: true } } } },
            affiliateLinks: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { clicks: true } },
          },
        },
      },
    });

    const agora = Date.now();

    return decisoes
      .filter((d) => d.deal !== null)
      .map((d) => {
        const deal = d.deal;
        const link = deal.affiliateLinks[0];

        return {
          dealId: deal.id,
          offerId: deal.productOfferId,
          titulo: deal.productOffer.product.title,
          precoCents: deal.priceCents,
          enviadoEm: d.decidedAt.toISOString(),
          enviadoPor: d.decidedBy,
          // O link publicado e o nosso redirecionador, nao o da Shopee.
          link: link ? `/r/${link.id}` : null,
          cliques: deal._count.clicks,
          diasAtras: Math.floor((agora - d.decidedAt.getTime()) / 86_400_000),
        };
      });
  }

  /** Serie completa de uma oferta, com o preco de referencia oficial. */
  async getOfferHistory(offerId: string): Promise<OfferHistory | null> {
    const offer = await this.prisma.productOffer.findUnique({
      where: { id: offerId },
      include: {
        product: { select: { title: true, imageUrl: true } },
        dailyPriceAggregates: { orderBy: { day: 'asc' }, take: 90 },
      },
    });

    if (!offer) {
      return null;
    }

    const aggs = offer.dailyPriceAggregates;
    const atual = aggs.length ? aggs[aggs.length - 1].closePriceCents : 0;
    const referencia = await this.priceReference.computeReferencePrice(offer.id, atual);

    return {
      id: offer.id,
      externalId: offer.externalId,
      titulo: offer.product.title,
      url: offer.url,
      imagem: offer.imageUrl ?? offer.product.imageUrl ?? null,
      loja: offer.sellerName,
      precoAtualCents: atual,
      referenciaCents: referencia.referencePriceCents,
      metodoReferencia: referencia.method,
      descontoReal:
        referencia.referencePriceCents > 0
          ? (referencia.referencePriceCents - atual) / referencia.referencePriceCents
          : 0,
      minimoCents: aggs.length ? Math.min(...aggs.map((a) => a.minPriceCents)) : 0,
      maximoCents: aggs.length ? Math.max(...aggs.map((a) => a.maxPriceCents)) : 0,
      diasHistorico: aggs.length,
      serie: aggs.map((a) => ({
        dia: a.day.toISOString().slice(0, 10),
        fechamento: a.closePriceCents,
        minimo: a.minPriceCents,
        maximo: a.maxPriceCents,
        observacoes: a.observationsCount,
      })),
    };
  }

  private mediana(valores: number[]): number {
    if (valores.length === 0) return 0;
    const ordenado = [...valores].sort((a, b) => a - b);
    const meio = Math.floor(ordenado.length / 2);
    return ordenado.length % 2 === 0
      ? Math.round((ordenado[meio - 1] + ordenado[meio]) / 2)
      : ordenado[meio];
  }
}
