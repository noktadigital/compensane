import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

export interface PreHikeAnalysis {
  detected: boolean;
  reason?: string;
  hikeDay?: Date;
  hikePriceCents?: number;
  normalPriceCents?: number;
}

/**
 * Detector de aumento artificial de preco (secao 8).
 *
 * Ideia: olhar os ultimos N dias antes do preco atual. Se houve um pico
 * relevante (preco subiu significativamente acima do normal) seguido de uma
 * queda de volta para perto do "preco normal" — e o preco atual e
 * apresentado como grande desconto sobre esse pico — isso e um falso
 * desconto. O vendedor infla o preco por alguns dias so para depois
 * "descontar" de volta ao preco de sempre.
 *
 * Em caso de incerteza (dados insuficientes para decidir com confianca),
 * o metodo retorna detected=false mas o chamador deve usar o confidence_score
 * separadamente — "melhor nao publicar" e uma decisao do DealScoringService,
 * nao deste detector.
 */
@Injectable()
export class PreHikeDetector {
  /** Janela retroativa em que procuramos por picos recentes. */
  private readonly LOOKBACK_DAYS = 14;
  /** Um pico e "relevante" se for X% acima do preco de referencia/normal. */
  private readonly HIKE_THRESHOLD = 0.15;
  /** Preco atual e considerado "de volta ao normal" se estiver dentro dessa banda do preco normal. */
  private readonly RETURN_TO_NORMAL_BAND = 0.08;

  constructor(private readonly prisma: PrismaService) {}

  async detect(
    productOfferId: string,
    currentPriceCents: number,
    referencePriceCents: number,
  ): Promise<PreHikeAnalysis> {
    const since = new Date(Date.now() - this.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const aggregates = await this.prisma.dailyPriceAggregate.findMany({
      where: { productOfferId, day: { gte: since } },
      orderBy: { day: 'asc' },
    });

    if (aggregates.length === 0) {
      return { detected: false };
    }

    const hikeThresholdPrice = referencePriceCents * (1 + this.HIKE_THRESHOLD);
    const spike = aggregates.find((a) => a.maxPriceCents >= hikeThresholdPrice);

    if (!spike) {
      return { detected: false };
    }

    const returnedToNormal =
      Math.abs(currentPriceCents - referencePriceCents) / referencePriceCents <=
      this.RETURN_TO_NORMAL_BAND;

    if (!returnedToNormal) {
      // Houve pico, mas o preco atual nao voltou perto do normal — nao e o
      // padrao de "infla e desconta", pode ser desconto real sobre um preco
      // que de fato mudou de patamar.
      return { detected: false };
    }

    return {
      detected: true,
      reason: `Pico de ${(spike.maxPriceCents / 100).toFixed(2)} detectado em ${spike.day.toISOString().slice(0, 10)}, preco atual voltou perto do normal (${(referencePriceCents / 100).toFixed(2)}). Desconto aparente e artificial.`,
      hikeDay: spike.day,
      hikePriceCents: spike.maxPriceCents,
      normalPriceCents: referencePriceCents,
    };
  }
}
