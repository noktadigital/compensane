import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';
import { PriceHistorySummary } from './price-statistics.service';

/**
 * Calcula o confidence_score (secao 6 — Cold Start). Considera:
 *   - dias de historico disponiveis (14d = inicial, 30d = moderado, 90d = alto)
 *   - numero de observacoes (series com poucos pontos sao menos confiaveis)
 *   - qualidade da serie (volatilidade extrema reduz confianca)
 *
 * Retorna um valor entre 0 e 1. Usado para multiplicar o Deal Score
 * (nunca aumentar confianca alem do que os dados sustentam).
 */
@Injectable()
export class ConfidenceScoreService {
  private readonly targetDays: number;

  constructor(@Optional() appConfig?: AppConfigService) {
    this.targetDays = appConfig?.dealRules.historyTargetDays ?? 90;
  }

  compute(summary: PriceHistorySummary): number {
    const window90 = summary.windows[90];
    const window30 = summary.windows[30];
    const window14 = summary.windows[14];

    const daysWithData = window90.count;

    // 1) Cobertura temporal: 14d=inicial (~0.4), 30d=moderada (~0.7), 90d=alta (~1.0)
    const historyDepthScore = this.historyDepthScore(daysWithData);

    // 2) Densidade de observacoes: poucas observacoes numa janela de dias longa
    //    tambem reduz confianca (ex: 90 dias corridos mas so 5 observacoes).
    const observationDensityScore = this.densityScore(summary.totalObservations, daysWithData);

    // 3) Qualidade/estabilidade da serie: volatilidade muito alta reduz confianca
    //    porque fica dificil identificar um preco de referencia estavel. So faz
    //    sentido confiar nessa metrica quando ha uma amostra minima de dias —
    //    caso contrario ela nao deve contribuir para a confianca (nem para cima
    //    nem para baixo).
    const volatilitySource = window30.count >= 5 ? window30 : window14.count >= 5 ? window14 : null;
    const stabilityScore = volatilitySource
      ? this.stabilityScore(volatilitySource.volatility ?? 1)
      : 0;

    const confidence =
      historyDepthScore * 0.5 + observationDensityScore * 0.25 + stabilityScore * 0.25;

    return Number(Math.min(1, Math.max(0, confidence)).toFixed(3));
  }

  private historyDepthScore(daysWithData: number): number {
    if (daysWithData <= 0) return 0;
    if (daysWithData >= this.targetDays) return 1;
    if (daysWithData >= 30) {
      // 30 -> 90 dias mapeia linearmente de 0.7 a 1.0
      return 0.7 + (0.3 * (daysWithData - 30)) / (this.targetDays - 30);
    }
    if (daysWithData >= 14) {
      // 14 -> 30 dias mapeia linearmente de 0.4 a 0.7
      return 0.4 + (0.3 * (daysWithData - 14)) / (30 - 14);
    }
    // 0 -> 14 dias mapeia linearmente de 0 a 0.4
    return (0.4 * daysWithData) / 14;
  }

  private densityScore(totalObservations: number, daysWithData: number): number {
    if (daysWithData <= 0) return 0;
    const observationsPerDay = totalObservations / daysWithData;
    // 1+ observacao por dia em media = score maximo; menos que isso degrada linearmente.
    return Math.min(1, observationsPerDay);
  }

  private stabilityScore(volatility: number): number {
    // Volatilidade (coef. de variacao) tipica de produtos estaveis: < 0.05.
    // Acima de 0.30 consideramos serie muito ruidosa para confiar plenamente.
    if (volatility <= 0.05) return 1;
    if (volatility >= 0.3) return 0.2;
    return 1 - ((volatility - 0.05) / (0.3 - 0.05)) * 0.8;
  }
}
