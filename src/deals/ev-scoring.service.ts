import { Injectable } from '@nestjs/common';

export interface EvInput {
  dealScore: number; // 0-100
  commissionCents: number;
  category?: string | null;
}

export interface EvEstimateParams {
  /** Probabilidade estimada de clique dado que a oferta foi publicada. */
  clickProbability?: number;
  /** Probabilidade estimada de conversao dado o clique. */
  conversionProbability?: number;
}

/**
 * EV (Expected Value) por post (secao 10).
 *
 * EV = P(clique) x P(conversao) x comissao_estimada
 *
 * No MVP as probabilidades sao heuristicas fixas, ajustadas apenas pelo
 * Deal Score (ofertas melhores tendem a converter mais). Futuramente estes
 * valores devem vir de um modelo treinado com CTR/conversao reais por
 * categoria, marketplace, horario, faixa de preco etc. — por isso a
 * assinatura ja aceita overrides externos.
 */
@Injectable()
export class EvScoringService {
  /** Heuristica inicial: probabilidade de clique cresce com o Deal Score. */
  private baselineClickProbability(dealScore: number): number {
    // Score 50 -> ~5% CTR; score 100 -> ~15% CTR (heuristica inicial, a recalibrar).
    return 0.05 + (Math.max(0, dealScore - 50) / 50) * 0.1;
  }

  /** Heuristica inicial: conversao fixa baseline, levemente maior para scores altos. */
  private baselineConversionProbability(dealScore: number): number {
    // Baseline ~4%, sobe ate ~8% para score 100 (heuristica inicial, a recalibrar).
    return 0.04 + (Math.max(0, dealScore - 50) / 50) * 0.04;
  }

  compute(input: EvInput, overrides: EvEstimateParams = {}): number {
    const clickProbability = overrides.clickProbability ?? this.baselineClickProbability(input.dealScore);
    const conversionProbability =
      overrides.conversionProbability ?? this.baselineConversionProbability(input.dealScore);

    const commissionReais = input.commissionCents / 100;
    const ev = clickProbability * conversionProbability * commissionReais;

    return Number(ev.toFixed(4));
  }
}
