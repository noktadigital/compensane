import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

export interface ReferencePriceResult {
  referencePriceCents: number;
  method: 'plateau_90d' | 'median_30d' | 'median_available' | 'current_price';
  plateauShareOfDays: number | null; // % dos dias na janela que ficaram no platô encontrado
}

interface PlateauCandidate {
  priceCents: number;
  dayCount: number;
}

/**
 * Determina o preco de referencia (P_ref) de uma oferta (secao 7).
 *
 * Estrategia:
 *   1. Tenta encontrar um "plateau" — um preco (ou faixa estreita de precos)
 *      que se repete na maioria dos dias dos ultimos 90 dias. Esse e o
 *      "preco normal" do produto, resistente a picos de 1-2 dias.
 *   2. Fallback: mediana dos ultimos 30 dias.
 *   3. Fallback final: mediana de todos os dias disponiveis, ou o preco atual
 *      se nao houver nenhum historico (cold start absoluto).
 */
@Injectable()
export class PriceReferenceService {
  /** Preços dentro dessa banda percentual são considerados "o mesmo plateau". */
  private readonly PLATEAU_BAND = 0.03;
  /** Um plateau só é aceito se cobrir pelo menos essa fração dos dias da janela. */
  private readonly MIN_PLATEAU_SHARE = 0.4;

  constructor(private readonly prisma: PrismaService) {}

  async computeReferencePrice(
    productOfferId: string,
    currentPriceCents: number,
  ): Promise<ReferencePriceResult> {
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const aggregates90 = await this.prisma.dailyPriceAggregate.findMany({
      where: { productOfferId, day: { gte: since90 } },
      orderBy: { day: 'asc' },
    });

    if (aggregates90.length === 0) {
      return {
        referencePriceCents: currentPriceCents,
        method: 'current_price',
        plateauShareOfDays: null,
      };
    }

    const closePrices90 = aggregates90.map((a) => a.closePriceCents);
    const plateau = this.findPlateau(closePrices90);

    if (plateau && plateau.dayCount / closePrices90.length >= this.MIN_PLATEAU_SHARE) {
      return {
        referencePriceCents: plateau.priceCents,
        method: 'plateau_90d',
        plateauShareOfDays: Number((plateau.dayCount / closePrices90.length).toFixed(3)),
      };
    }

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const closePrices30 = closePrices90.filter((_, idx) => aggregates90[idx].day >= since30);

    if (closePrices30.length > 0) {
      return {
        referencePriceCents: this.median(closePrices30),
        method: 'median_30d',
        plateauShareOfDays: null,
      };
    }

    return {
      referencePriceCents: this.median(closePrices90),
      method: 'median_available',
      plateauShareOfDays: null,
    };
  }

  /**
   * Agrupa precos proximos entre si (dentro de PLATEAU_BAND) e retorna o
   * grupo com maior numero de dias — o "preco estavel" dominante da serie.
   */
  private findPlateau(prices: number[]): PlateauCandidate | null {
    if (prices.length === 0) return null;

    const sorted = [...prices].sort((a, b) => a - b);
    let bestCandidate: PlateauCandidate | null = null;

    for (const anchor of sorted) {
      const lowerBound = anchor * (1 - this.PLATEAU_BAND);
      const upperBound = anchor * (1 + this.PLATEAU_BAND);
      const inBand = prices.filter((p) => p >= lowerBound && p <= upperBound);

      if (inBand.length === 0) continue;

      const representativePrice = this.median(inBand);
      const candidate: PlateauCandidate = {
        priceCents: representativePrice,
        dayCount: inBand.length,
      };

      if (!bestCandidate || candidate.dayCount > bestCandidate.dayCount) {
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }
}
