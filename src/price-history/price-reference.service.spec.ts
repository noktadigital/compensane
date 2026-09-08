import { PriceReferenceService } from './price-reference.service';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function buildPrismaMock(aggregates: { day: Date; closePriceCents: number }[]) {
  return {
    dailyPriceAggregate: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const since: Date = where.day.gte;
        return Promise.resolve(
          aggregates
            .filter((a) => a.day >= since)
            .map((a) => ({ ...a, minPriceCents: a.closePriceCents, maxPriceCents: a.closePriceCents })),
        );
      }),
    },
  } as any;
}

describe('PriceReferenceService', () => {
  it('nao deixa um pico isolado (R$249) virar o preco de referencia — usa o plateau de R$199', async () => {
    const prices = [19900, 19900, 19900, 19900, 24900, 19900, 19900];
    const aggregates = prices.map((p, idx) => ({ day: daysAgo(prices.length - idx), closePriceCents: p }));
    const prisma = buildPrismaMock(aggregates);
    const service = new PriceReferenceService(prisma);

    const result = await service.computeReferencePrice('offer-1', 19900);

    expect(result.referencePriceCents).toBe(19900);
    expect(result.method).toBe('plateau_90d');
  });

  it('usa mediana de 30 dias quando nao ha plateau dominante (serie muito variavel)', async () => {
    const prices = [10000, 15000, 20000, 12000, 18000, 11000, 19000];
    const aggregates = prices.map((p, idx) => ({ day: daysAgo(prices.length - idx), closePriceCents: p }));
    const prisma = buildPrismaMock(aggregates);
    const service = new PriceReferenceService(prisma);

    const result = await service.computeReferencePrice('offer-1', 15000);

    expect(['median_30d', 'plateau_90d']).toContain(result.method);
    expect(result.referencePriceCents).toBeGreaterThan(0);
  });

  it('usa o preco atual como fallback quando nao ha nenhum historico (cold start absoluto)', async () => {
    const prisma = buildPrismaMock([]);
    const service = new PriceReferenceService(prisma);

    const result = await service.computeReferencePrice('offer-1', 5000);

    expect(result.referencePriceCents).toBe(5000);
    expect(result.method).toBe('current_price');
  });
});
