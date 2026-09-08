import { Injectable, Logger } from '@nestjs/common';
import { Deal, DealStatus, ProductOffer } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { AppConfigService } from '@/config/app-config.service';
import { PriceStatisticsService } from '@/price-history/price-statistics.service';
import { PriceReferenceService } from '@/price-history/price-reference.service';
import { ConfidenceScoreService } from '@/price-history/confidence-score.service';
import { DealScoringService } from './deal-scoring.service';
import { PreHikeDetector } from './pre-hike-detector.service';
import { EvScoringService } from './ev-scoring.service';

export interface DealAnalysisResult {
  deal: Deal | null;
  discarded: boolean;
  reasons: string[];
}

/**
 * Analysis Engine (secao 18): orquestra estatisticas + preco de referencia +
 * confianca + pre-hike + Deal Score + EV, aplica os filtros da secao 11 e
 * persiste um Deal quando a oferta passa em todos os criterios.
 */
@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly priceStats: PriceStatisticsService,
    private readonly priceReference: PriceReferenceService,
    private readonly confidenceScore: ConfidenceScoreService,
    private readonly dealScoring: DealScoringService,
    private readonly preHikeDetector: PreHikeDetector,
    private readonly evScoring: EvScoringService,
  ) {}

  async analyzeOffer(productOfferId: string): Promise<DealAnalysisResult> {
    const offer = await this.prisma.productOffer.findUnique({
      where: { id: productOfferId },
      include: { product: true },
    });

    if (!offer) {
      return { deal: null, discarded: true, reasons: ['oferta nao encontrada'] };
    }

    const latestObservation = await this.prisma.priceObservation.findFirst({
      where: { productOfferId },
      orderBy: { observedAt: 'desc' },
    });

    if (!latestObservation) {
      return { deal: null, discarded: true, reasons: ['sem observacao de preco'] };
    }

    const reasons: string[] = [];

    // --- Filtros duros (secao 11) ---
    if (!latestObservation.inStock) {
      reasons.push('sem estoque');
    }
    if (latestObservation.priceCents <= 0) {
      reasons.push('preco invalido');
    }
    if (!latestObservation.commissionCents || latestObservation.commissionCents <= 0) {
      reasons.push('comissao inexistente ou invalida');
    }

    const historySummary = await this.priceStats.getSummary(productOfferId);
    const reference = await this.priceReference.computeReferencePrice(
      productOfferId,
      latestObservation.priceCents,
    );
    const confidence = this.confidenceScore.compute(historySummary);

    const preHike = await this.preHikeDetector.detect(
      productOfferId,
      latestObservation.priceCents,
      reference.referencePriceCents,
    );
    if (preHike.detected) {
      reasons.push(`aumento artificial detectado: ${preHike.reason}`);
    }

    const scoreResult = this.dealScoring.compute({
      currentPriceCents: latestObservation.priceCents,
      referencePriceCents: reference.referencePriceCents,
      historySummary,
      commissionCents: latestObservation.commissionCents,
      freeShipping: (latestObservation.shippingCents ?? 0) === 0,
      hasCoupon: false, // nao suportado ainda pelo adapter — reservado para o futuro
      inStock: latestObservation.inStock,
      ratingStar: offer.ratingStar,
      salesCount: offer.salesCount,
      confidenceScore: confidence,
    });

    if (scoreResult.discountRate < this.appConfig.dealRules.minRealDiscount) {
      reasons.push(
        `desconto real (${(scoreResult.discountRate * 100).toFixed(1)}%) abaixo do minimo configurado`,
      );
    }

    // Confianca muito baixa: nao publicar mesmo que o score bruto pareça bom.
    const MIN_CONFIDENCE = 0.35;
    if (confidence < MIN_CONFIDENCE) {
      reasons.push(`confianca insuficiente (${confidence}) — historico curto demais`);
    }

    const ev = this.evScoring.compute({
      dealScore: scoreResult.finalScore,
      commissionCents: latestObservation.commissionCents ?? 0,
      category: offer.product.category,
    });

    if (reasons.length > 0) {
      this.logger.debug(`Oferta ${productOfferId} descartada: ${reasons.join('; ')}`);
      return { deal: null, discarded: true, reasons };
    }

    const deal = await this.prisma.deal.create({
      data: {
        productOfferId,
        status: DealStatus.DETECTED,
        dealScore: scoreResult.finalScore,
        confidenceScore: confidence,
        evScore: ev,
        priceCents: latestObservation.priceCents,
        referencePriceCents: reference.referencePriceCents,
        discountRate: scoreResult.discountRate,
        minPrice90dCents: historySummary.windows[90].minCents,
        commissionCents: latestObservation.commissionCents,
        freeShipping: (latestObservation.shippingCents ?? 0) === 0,
        preHikeDetected: false,
        scoreBreakdown: scoreResult.breakdown as any,
      },
    });

    this.logger.log(
      `Deal detectado para oferta ${productOfferId}: score=${scoreResult.finalScore} ev=${ev}`,
    );

    return { deal, discarded: false, reasons: [] };
  }

  /** Ofertas com Deal Score suficiente para publicacao (secao 11), ainda nao publicadas. */
  async findPublishableDeals(): Promise<Deal[]> {
    return this.prisma.deal.findMany({
      where: {
        status: DealStatus.DETECTED,
        dealScore: { gte: this.appConfig.dealRules.publishScore },
      },
      orderBy: [{ evScore: 'desc' }, { dealScore: 'desc' }],
      include: { productOffer: { include: { product: true } } },
    });
  }

  async markPublished(dealId: string): Promise<Deal> {
    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  async getDealWithOffer(dealId: string) {
    return this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { productOffer: { include: { product: true } } },
    });
  }
}
