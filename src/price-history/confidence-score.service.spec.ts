import { ConfidenceScoreService } from './confidence-score.service';
import { PriceHistorySummary, PriceWindowStats } from './price-statistics.service';

function buildWindow(overrides: Partial<PriceWindowStats> = {}): PriceWindowStats {
  return {
    windowDays: 90,
    count: 0,
    minCents: null,
    maxCents: null,
    meanCents: null,
    medianCents: null,
    modeCents: null,
    volatility: null,
    firstObservedAt: null,
    lastObservedAt: null,
    ...overrides,
  };
}

function buildSummary(totalObservations: number, days: Record<7 | 14 | 30 | 90, number>, volatility = 0.02): PriceHistorySummary {
  return {
    currentPriceCents: 10000,
    totalObservations,
    distinctDaysWithData: days[90],
    windows: {
      7: buildWindow({ windowDays: 7, count: days[7], volatility }),
      14: buildWindow({ windowDays: 14, count: days[14], volatility }),
      30: buildWindow({ windowDays: 30, count: days[30], volatility }),
      90: buildWindow({ windowDays: 90, count: days[90], volatility }),
    },
  };
}

describe('ConfidenceScoreService', () => {
  let service: ConfidenceScoreService;

  beforeEach(() => {
    service = new ConfidenceScoreService();
  });

  it('retorna confianca baixa para pouco historico (3 dias)', () => {
    const summary = buildSummary(3, { 7: 3, 14: 3, 30: 3, 90: 3 });
    const confidence = service.compute(summary);

    expect(confidence).toBeLessThan(0.3);
  });

  it('retorna confianca moderada para 30 dias de historico', () => {
    const summary = buildSummary(30, { 7: 7, 14: 14, 30: 30, 90: 30 });
    const confidence = service.compute(summary);

    expect(confidence).toBeGreaterThanOrEqual(0.5);
    expect(confidence).toBeLessThan(0.9);
  });

  it('retorna confianca alta para 90 dias de historico denso e estavel', () => {
    const summary = buildSummary(90, { 7: 7, 14: 14, 30: 30, 90: 90 }, 0.01);
    const confidence = service.compute(summary);

    expect(confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reduz a confianca quando a serie e muito volatil, mesmo com 90 dias de dados', () => {
    const stable = service.compute(buildSummary(90, { 7: 7, 14: 14, 30: 30, 90: 90 }, 0.02));
    const volatile = service.compute(buildSummary(90, { 7: 7, 14: 14, 30: 30, 90: 90 }, 0.35));

    expect(volatile).toBeLessThan(stable);
  });

  it('retorna 0 quando nao ha nenhum dado', () => {
    const summary = buildSummary(0, { 7: 0, 14: 0, 30: 0, 90: 0 });
    expect(service.compute(summary)).toBe(0);
  });
});
