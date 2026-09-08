import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Constroi/atualiza agregacoes diarias (product_price_daily, secao 5) a partir
 * das observacoes brutas. Roda apos a coleta (job aggregate:daily).
 */
@Injectable()
export class PriceAggregationService {
  private readonly logger = new Logger(PriceAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Recalcula a agregacao diaria de uma oferta para o dia informado (default: hoje). */
  async aggregateDay(productOfferId: string, day: Date = new Date()): Promise<void> {
    const dayStart = startOfUtcDay(day);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const observations = await this.prisma.priceObservation.findMany({
      where: {
        productOfferId,
        observedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { observedAt: 'asc' },
    });

    if (observations.length === 0) {
      return;
    }

    const prices = observations.map((o) => o.priceCents);
    const minPriceCents = Math.min(...prices);
    const maxPriceCents = Math.max(...prices);
    const closePriceCents = observations[observations.length - 1].priceCents;
    const offer = await this.prisma.productOffer.findUniqueOrThrow({
      where: { id: productOfferId },
      select: { marketplace: true },
    });

    await this.prisma.dailyPriceAggregate.upsert({
      where: {
        productOfferId_day: { productOfferId, day: dayStart },
      },
      create: {
        productOfferId,
        source: offer.marketplace,
        day: dayStart,
        minPriceCents,
        maxPriceCents,
        closePriceCents,
        observationsCount: observations.length,
      },
      update: {
        minPriceCents,
        maxPriceCents,
        closePriceCents,
        observationsCount: observations.length,
      },
    });

    this.logger.debug(
      `Agregacao diaria atualizada para oferta ${productOfferId} (${dayStart.toISOString().slice(0, 10)})`,
    );
  }

  /** Roda a agregacao do dia atual para todas as ofertas que tiveram observacao hoje. */
  async aggregateAllForToday(): Promise<number> {
    const dayStart = startOfUtcDay(new Date());
    const offerIds = await this.prisma.priceObservation.findMany({
      where: { observedAt: { gte: dayStart } },
      distinct: ['productOfferId'],
      select: { productOfferId: true },
    });

    for (const { productOfferId } of offerIds) {
      await this.aggregateDay(productOfferId, dayStart);
    }

    return offerIds.length;
  }
}
