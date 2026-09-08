import { Injectable } from '@nestjs/common';
import { PriceHistorySummary } from '@/price-history/price-statistics.service';

export interface ScoreBreakdown {
  desconto: number; // 0-40
  minimo: number; // 0-20
  comissao: number; // 0-15
  atrito: number; // 0-10
  estabilidade: number; // 0-10
  demanda: number; // 0-5
}

export interface DealScoreInput {
  currentPriceCents: number;
  referencePriceCents: number;
  historySummary: PriceHistorySummary;
  commissionCents: number | null;
  freeShipping: boolean;
  hasCoupon: boolean;
  inStock: boolean;
  ratingStar: number | null;
  salesCount: number | null;
  confidenceScore: number; // 0-1, vindo do ConfidenceScoreService
}

export interface DealScoreResult {
  rawScore: number; // soma dos componentes, 0-100, antes do fator de confianca
  finalScore: number; // rawScore * confidenceScore, arredondado, 0-100
  breakdown: ScoreBreakdown;
  discountRate: number; // (referencePriceCents - currentPriceCents) / referencePriceCents
}

/**
 * Deal Score (secao 9). Modulo isolado para que os pesos possam ser
 * ajustados sem reescrever o resto do sistema — apenas os metodos privados
 * `score*` precisam mudar.
 *
 * Composicao (soma = 100):
 *   S_desconto     0-40  quanto o preco atual esta abaixo do preco de referencia
 *   S_minimo       0-20  proximidade do menor preco historico (90d)
 *   S_comissao     0-15  quanto a oferta pode gerar em comissao
 *   S_atrito       0-10  frete gratis / cupom / estoque disponivel
 *   S_estabilidade 0-10  quao estavel é o historico (baixa volatilidade = mais confiavel)
 *   S_demanda      0-5   vendas/rating/popularidade
 *
 * O resultado final aplica o confidence_score (cold start, secao 6) como
 * fator multiplicativo — pouco historico nunca deve gerar um score alto.
 */
@Injectable()
export class DealScoringService {
  compute(input: DealScoreInput): DealScoreResult {
    const discountRate = this.calcDiscountRate(input.currentPriceCents, input.referencePriceCents);

    const desconto = this.scoreDesconto(discountRate);
    const minimo = this.scoreMinimo(input.currentPriceCents, input.historySummary);
    const comissao = this.scoreComissao(input.commissionCents, input.currentPriceCents);
    const atrito = this.scoreAtrito(input.freeShipping, input.hasCoupon, input.inStock);
    const estabilidade = this.scoreEstabilidade(input.historySummary);
    const demanda = this.scoreDemanda(input.ratingStar, input.salesCount);

    const breakdown: ScoreBreakdown = { desconto, minimo, comissao, atrito, estabilidade, demanda };
    const rawScore = desconto + minimo + comissao + atrito + estabilidade + demanda;
    const finalScore = Math.round(Math.min(100, rawScore) * input.confidenceScore);

    return {
      rawScore: Math.round(rawScore),
      finalScore,
      breakdown,
      discountRate,
    };
  }

  private calcDiscountRate(currentCents: number, referenceCents: number): number {
    if (referenceCents <= 0) return 0;
    const rate = (referenceCents - currentCents) / referenceCents;
    return Number(Math.max(0, rate).toFixed(4));
  }

  /** 0-40: escala linear ate 40% de desconto real = score maximo. */
  private scoreDesconto(discountRate: number): number {
    const CAP_DISCOUNT = 0.4;
    const normalized = Math.min(1, discountRate / CAP_DISCOUNT);
    return Math.round(normalized * 40);
  }

  /** 0-20: quao perto o preco atual esta do minimo historico de 90 dias. */
  private scoreMinimo(currentCents: number, summary: PriceHistorySummary): number {
    const min90 = summary.windows[90].minCents;
    if (!min90 || min90 <= 0) return 0;

    if (currentCents <= min90) return 20; // empatou ou superou o minimo historico

    // Quanto mais proximo do minimo, maior o score. Distancia de 20%+ do minimo => score 0.
    const distanceRatio = (currentCents - min90) / min90;
    const normalized = Math.max(0, 1 - distanceRatio / 0.2);
    return Math.round(normalized * 20);
  }

  /** 0-15: comissao em R$ (nao em %), pois o objetivo e maximizar receita absoluta. */
  private scoreComissao(commissionCents: number | null, priceCents: number): number {
    if (!commissionCents || commissionCents <= 0) return 0;
    // Normaliza usando R$20 de comissao como teto pratico para score maximo.
    const CAP_COMMISSION_CENTS = 2000;
    const normalized = Math.min(1, commissionCents / CAP_COMMISSION_CENTS);
    return Math.round(normalized * 15);
  }

  /** 0-10: frete gratis (5) + cupom (3) + estoque disponivel (2). */
  private scoreAtrito(freeShipping: boolean, hasCoupon: boolean, inStock: boolean): number {
    let score = 0;
    if (freeShipping) score += 5;
    if (hasCoupon) score += 3;
    if (inStock) score += 2;
    return score;
  }

  /** 0-10: baixa volatilidade (serie estavel) = maior confianca no historico. */
  private scoreEstabilidade(summary: PriceHistorySummary): number {
    const volatility = summary.windows[30].volatility ?? summary.windows[14].volatility;
    if (volatility === null || volatility === undefined) return 0;

    if (volatility <= 0.03) return 10;
    if (volatility >= 0.25) return 0;
    const normalized = 1 - (volatility - 0.03) / (0.25 - 0.03);
    return Math.round(normalized * 10);
  }

  /** 0-5: combinacao de rating e volume de vendas. */
  private scoreDemanda(ratingStar: number | null, salesCount: number | null): number {
    let score = 0;
    if (ratingStar !== null) {
      // rating 4.5+ = pontuacao cheia de rating (3 pts)
      score += Math.max(0, Math.min(3, ((ratingStar - 3) / 1.5) * 3));
    }
    if (salesCount !== null) {
      // 1000+ vendas = pontuacao cheia de vendas (2 pts), escala log
      const salesScore = Math.min(2, Math.log10(salesCount + 1) / Math.log10(1001) * 2);
      score += Math.max(0, salesScore);
    }
    return Math.round(score);
  }
}
