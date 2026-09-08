import { DealScoringService, DealScoreInput } from './deal-scoring.service';
import { PriceHistorySummary, PriceWindowStats } from '@/price-history/price-statistics.service';

function buildWindow(overrides: Partial<PriceWindowStats> = {}): PriceWindowStats {
  return {
    windowDays: 90,
    count: 90,
    minCents: 15000,
    maxCents: 20000,
    meanCents: 17000,
    medianCents: 17000,
    modeCents: 17000,
    volatility: 0.02,
    firstObservedAt: new Date(),
    lastObservedAt: new Date(),
    ...overrides,
  };
}

function buildSummary(overrides: Partial<Record<7 | 14 | 30 | 90, Partial<PriceWindowStats>>> = {}): PriceHistorySummary {
  return {
    currentPriceCents: 15000,
    distinctDaysWithData: 90,
    totalObservations: 90,
    windows: {
      7: buildWindow({ windowDays: 7, count: 7, ...overrides[7] }),
      14: buildWindow({ windowDays: 14, count: 14, ...overrides[14] }),
      30: buildWindow({ windowDays: 30, count: 30, ...overrides[30] }),
      90: buildWindow({ windowDays: 90, count: 90, ...overrides[90] }),
    },
  };
}

function buildInput(overrides: Partial<DealScoreInput> = {}): DealScoreInput {
  return {
    currentPriceCents: 15000,
    referencePriceCents: 20000,
    historySummary: buildSummary(),
    commissionCents: 1500,
    freeShipping: true,
    hasCoupon: false,
    inStock: true,
    ratingStar: 4.8,
    salesCount: 5000,
    confidenceScore: 1,
    ...overrides,
  };
}

describe('DealScoringService', () => {
  let service: DealScoringService;

  beforeEach(() => {
    service = new DealScoringService();
  });

  it('gera score alto para desconto real com historico solido (preco caiu de verdade)', () => {
    const result = service.compute(
      buildInput({
        currentPriceCents: 15000,
        referencePriceCents: 20000, // 25% de desconto real
        historySummary: buildSummary({ 90: { minCents: 14900 } }),
      }),
    );

    expect(result.discountRate).toBeCloseTo(0.25, 2);
    expect(result.finalScore).toBeGreaterThanOrEqual(70);
  });

  it('nao gera desconto quando preco de referencia e igual ao preco atual (falso desconto)', () => {
    const result = service.compute(
      buildInput({
        currentPriceCents: 19900,
        referencePriceCents: 19900, // preco de referencia calculado corretamente pelo plateau
      }),
    );

    expect(result.discountRate).toBe(0);
    expect(result.breakdown.desconto).toBe(0);
  });

  it('da score maximo de minimo quando preco atual iguala o minimo historico', () => {
    const result = service.compute(
      buildInput({
        currentPriceCents: 14900,
        historySummary: buildSummary({ 90: { minCents: 14900 } }),
      }),
    );

    expect(result.breakdown.minimo).toBe(20);
  });

  it('aplica o fator de confianca reduzindo o score final quando ha pouco historico', () => {
    const fullConfidence = service.compute(buildInput({ confidenceScore: 1 }));
    const lowConfidence = service.compute(buildInput({ confidenceScore: 0.3 }));

    expect(lowConfidence.rawScore).toBe(fullConfidence.rawScore);
    expect(lowConfidence.finalScore).toBeLessThan(fullConfidence.finalScore);
    expect(lowConfidence.finalScore).toBe(Math.round(fullConfidence.rawScore * 0.3));
  });

  it('penaliza oferta sem estoque via score de atrito (sem os 2 pontos de estoque)', () => {
    const withStock = service.compute(buildInput({ inStock: true }));
    const withoutStock = service.compute(buildInput({ inStock: false }));

    expect(withoutStock.breakdown.atrito).toBe(withStock.breakdown.atrito - 2);
  });

  it('da score de comissao maior para comissao alta em reais', () => {
    const lowCommission = service.compute(buildInput({ commissionCents: 100 }));
    const highCommission = service.compute(buildInput({ commissionCents: 3000 }));

    expect(highCommission.breakdown.comissao).toBeGreaterThan(lowCommission.breakdown.comissao);
  });

  it('premia frete gratis no score de atrito', () => {
    const withShipping = service.compute(buildInput({ freeShipping: true }));
    const withoutShipping = service.compute(buildInput({ freeShipping: false }));

    expect(withShipping.breakdown.atrito).toBeGreaterThan(withoutShipping.breakdown.atrito);
  });

  it('reduz score de estabilidade quando a serie e muito volatil', () => {
    const stable = service.compute(
      buildInput({ historySummary: buildSummary({ 30: { volatility: 0.01 } }) }),
    );
    const volatile = service.compute(
      buildInput({ historySummary: buildSummary({ 30: { volatility: 0.3 } }) }),
    );

    expect(stable.breakdown.estabilidade).toBeGreaterThan(volatile.breakdown.estabilidade);
  });
});
