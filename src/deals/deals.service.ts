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
import { MaturityCriteriaService } from './maturity-criteria.service';

/**
 * Janela de silencio por oferta. Dentro dela, a mesma oferta so gera um novo
 * alerta se o preco cair abaixo do que ja foi alertado.
 */
const DEAL_COOLDOWN_HOURS = 72;

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
    private readonly maturityCriteria: MaturityCriteriaService,
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

    // Criterio PROGRESSIVO: quanto menos historico, maior o desconto exigido
    // (para nao confundir ruido com oferta) e menor a confianca cobrada (que e
    // estruturalmente baixa no inicio). Sem isso o sistema fica impossivel de
    // satisfazer no dia zero — com 1 ponto de historico o desconto real e
    // sempre 0% — e sem ofertas chegando nunca se constroi historico.
    const criteria = this.maturityCriteria.resolve(historySummary.distinctDaysWithData);

    if (scoreResult.discountRate < criteria.minRealDiscount) {
      reasons.push(
        `desconto real (${(scoreResult.discountRate * 100).toFixed(1)}%) abaixo do minimo de ${(criteria.minRealDiscount * 100).toFixed(0)}% exigido na fase "${criteria.stage}" (${criteria.daysWithData}d de historico)`,
      );
    }

    if (confidence < criteria.minConfidence) {
      reasons.push(
        `confianca ${confidence} abaixo do minimo ${criteria.minConfidence} da fase "${criteria.stage}"`,
      );
    }

    // Anti-repeticao: sem isto, o tier HOT (a cada 15min) geraria um card novo
    // para a MESMA promocao a cada ciclo, inundando o canal de aprovacao.
    // So volta a alertar sobre a mesma oferta se o preco cair mais ainda.
    const recentDeal = await this.findRecentDealForOffer(productOfferId);
    if (recentDeal && latestObservation.priceCents >= recentDeal.priceCents) {
      reasons.push(
        `ja alertado em ${recentDeal.detectedAt.toISOString().slice(0, 10)} por ${(recentDeal.priceCents / 100).toFixed(2)} — preco nao caiu desde entao`,
      );
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

  /**
   * Ultimo Deal gerado para a oferta dentro da janela de silencio. Serve para
   * nao realertar a mesma promocao: uma oferta que ficou 3 dias em promocao
   * nao deve virar 288 cards.
   */
  private async findRecentDealForOffer(productOfferId: string): Promise<Deal | null> {
    const since = new Date(Date.now() - DEAL_COOLDOWN_HOURS * 60 * 60 * 1000);

    return this.prisma.deal.findFirst({
      where: { productOfferId, detectedAt: { gte: since } },
      orderBy: { detectedAt: 'desc' },
    });
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

  /**
   * Marca o deal como recusado. O card some do Discord, mas o registro fica:
   * e o que impede a mesma oferta de voltar no proximo ciclo e o que permite
   * medir depois o que costuma ser recusado.
   */
  async markRejected(dealId: string): Promise<Deal> {
    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.REJECTED },
    });
  }

  async getDealWithOffer(dealId: string) {
    return this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { productOffer: { include: { product: true } } },
    });
  }
}
