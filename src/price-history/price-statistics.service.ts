import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

export interface PriceWindowStats {
  windowDays: number;
  count: number;
  minCents: number | null;
  maxCents: number | null;
  meanCents: number | null;
  medianCents: number | null;
  modeCents: number | null;
  volatility: number | null; // desvio padrao / media (coeficiente de variacao)
  firstObservedAt: Date | null;
  lastObservedAt: Date | null;
}

export interface PriceHistorySummary {
  currentPriceCents: number | null;
  windows: Record<7 | 14 | 30 | 90, PriceWindowStats>;
  distinctDaysWithData: number;
  totalObservations: number;
}

/**
 * Calcula estatisticas de historico de preco (secao 5): minimos/maximos por
 * janela, media, mediana, preco mais frequente (moda), volatilidade.
 * Usa DailyPriceAggregate (close_price de cada dia) como serie principal —
 * mais estavel que observacoes brutas para calculos de tendencia/plateau.
 */
@Injectable()
export class PriceStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(productOfferId: string): Promise<PriceHistorySummary> {
    const [windows7, windows14, windows30, windows90, latestObservation] = await Promise.all([
      this.getWindowStats(productOfferId, 7),
      this.getWindowStats(productOfferId, 14),
      this.getWindowStats(productOfferId, 30),
      this.getWindowStats(productOfferId, 90),
      this.prisma.priceObservation.findFirst({
        where: { productOfferId },
        orderBy: { observedAt: 'desc' },
      }),
    ]);

    const distinctDays = await this.prisma.dailyPriceAggregate.count({
      where: { productOfferId },
    });

    const totalObservations = await this.prisma.priceObservation.count({
      where: { productOfferId },
    });

    return {
      currentPriceCents: latestObservation?.priceCents ?? null,
      windows: {
        7: windows7,
        14: windows14,
        30: windows30,
        90: windows90,
      },
      distinctDaysWithData: distinctDays,
      totalObservations,
    };
  }

  async getWindowStats(productOfferId: string, windowDays: number): Promise<PriceWindowStats> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const aggregates = await this.prisma.dailyPriceAggregate.findMany({
      where: { productOfferId, day: { gte: since } },
      orderBy: { day: 'asc' },
    });

    if (aggregates.length === 0) {
      return {
        windowDays,
        count: 0,
        minCents: null,
        maxCents: null,
        meanCents: null,
        medianCents: null,
        modeCents: null,
        volatility: null,
        firstObservedAt: null,
        lastObservedAt: null,
      };
    }

    // Usa o preco de fechamento de cada dia como um ponto da serie.
    const closePrices = aggregates.map((a) => a.closePriceCents);
    const minCents = Math.min(...aggregates.map((a) => a.minPriceCents));
    const maxCents = Math.max(...aggregates.map((a) => a.maxPriceCents));
    const meanCents = this.mean(closePrices);
    const medianCents = this.median(closePrices);
    const modeCents = this.mode(closePrices);
    const volatility = this.coefficientOfVariation(closePrices, meanCents);

    return {
      windowDays,
      count: aggregates.length,
      minCents,
      maxCents,
      meanCents: Math.round(meanCents),
      medianCents,
      modeCents,
      volatility,
      firstObservedAt: aggregates[0].day,
      lastObservedAt: aggregates[aggregates.length - 1].day,
    };
  }

  private mean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  /** Preco mais frequente. Em caso de empate, retorna o menor valor entre os empatados. */
  private mode(values: number[]): number {
    const counts = new Map<number, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let bestValue = values[0];
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount || (count === bestCount && value < bestValue)) {
        bestValue = value;
        bestCount = count;
      }
    }
    return bestValue;
  }

  private coefficientOfVariation(values: number[], mean: number): number {
    if (mean === 0 || values.length < 2) return 0;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return Number((stdDev / mean).toFixed(4));
  }
}
