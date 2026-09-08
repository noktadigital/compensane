import { Injectable, Logger } from '@nestjs/common';
import { DecisionType } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';

/**
 * Registro de decisoes e cliques (secao 16). Responde perguntas como
 * "qual oferta realmente gera dinheiro?" ao longo do tempo, combinando
 * DealDecision (aprovacao/rejeicao humana) e Click (cliques no redirect).
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordDecision(params: {
    dealId: string;
    decision: DecisionType;
    decidedBy?: string;
    reason?: string;
  }) {
    const decision = await this.prisma.dealDecision.create({
      data: {
        dealId: params.dealId,
        decision: params.decision,
        decidedBy: params.decidedBy,
        reason: params.reason,
      },
    });

    if (params.decision === DecisionType.APPROVE) {
      await this.prisma.deal.update({
        where: { id: params.dealId },
        data: { status: 'APPROVED' },
      });
    } else {
      await this.prisma.deal.update({
        where: { id: params.dealId },
        data: { status: 'REJECTED' },
      });
    }

    this.logger.log(`Decisao registrada para deal ${params.dealId}: ${params.decision}`);
    return decision;
  }

  async recordClick(params: {
    slug: string;
    dealId?: string;
    affiliateLinkId?: string;
    ipHash?: string;
    userAgent?: string;
  }) {
    return this.prisma.click.create({
      data: {
        slug: params.slug,
        dealId: params.dealId,
        affiliateLinkId: params.affiliateLinkId,
        ipHash: params.ipHash,
        userAgent: params.userAgent,
      },
    });
  }

  /** Metricas basicas de observabilidade (secao 27). */
  async getBasicMetrics() {
    const [monitoredOffers, totalObservations, detectedDeals, approvedDeals, rejectedDeals, totalClicks] =
      await Promise.all([
        this.prisma.productOffer.count({ where: { active: true } }),
        this.prisma.priceObservation.count(),
        this.prisma.deal.count(),
        this.prisma.deal.count({ where: { status: 'APPROVED' } }),
        this.prisma.deal.count({ where: { status: 'REJECTED' } }),
        this.prisma.click.count(),
      ]);

    const avgScoreResult = await this.prisma.deal.aggregate({
      _avg: { dealScore: true },
    });

    return {
      monitoredOffers,
      totalObservations,
      detectedDeals,
      approvedDeals,
      rejectedDeals,
      totalClicks,
      avgDealScore: avgScoreResult._avg.dealScore ?? 0,
    };
  }
}
