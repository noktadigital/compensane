import { Injectable } from '@nestjs/common';

export interface BasicMetrics {
  monitoredOffers: number;
  totalObservations: number;
  detectedDeals: number;
  approvedDeals: number;
  rejectedDeals: number;
  totalClicks: number;
  avgDealScore: number;
}

@Injectable()
export class TrackingMetricsFormatter {
  format(metrics: BasicMetrics): string {
    return [
      '📊 Status do sistema',
      '',
      `🛒 Ofertas monitoradas: ${metrics.monitoredOffers}`,
      `📈 Observações de preço: ${metrics.totalObservations}`,
      `🔥 Deals detectados: ${metrics.detectedDeals}`,
      `✅ Aprovados: ${metrics.approvedDeals}`,
      `❌ Rejeitados: ${metrics.rejectedDeals}`,
      `🖱️ Cliques: ${metrics.totalClicks}`,
      `⭐ Score médio: ${metrics.avgDealScore.toFixed(1)}`,
    ].join('\n');
  }
}
