import { Injectable } from '@nestjs/common';
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
  precoAtualCents: number;
  minimoCents: number;
  maximoCents: number;
  diasHistorico: number;
  descontoReal: number;
  ultimaColeta: string | null;
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
      where: { active: true },
      include: {
        product: { select: { title: true } },
        dailyPriceAggregates: { orderBy: { day: 'desc' }, take: 90 },
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

        return {
          id: offer.id,
          titulo: offer.product.title,
          precoAtualCents: atual,
          minimoCents: minimo,
          maximoCents: maximo,
          diasHistorico: aggs.length,
          descontoReal: mediana > 0 ? (mediana - atual) / mediana : 0,
          ultimaColeta: offer.lastCollectedAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.diasHistorico - a.diasHistorico || b.descontoReal - a.descontoReal);
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
