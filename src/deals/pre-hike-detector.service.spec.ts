import { PreHikeDetector } from './pre-hike-detector.service';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function buildPrismaMock(aggregates: { day: Date; minPriceCents: number; maxPriceCents: number; closePriceCents: number }[]) {
  return {
    dailyPriceAggregate: {
      findMany: jest.fn().mockResolvedValue(aggregates),
    },
  } as any;
}

describe('PreHikeDetector', () => {
  it('detecta aumento artificial: pico recente seguido de retorno ao preco normal', async () => {
    const normalPrice = 10000;
    const hikePrice = 15000; // 50% acima do normal
    const aggregates = [
      { day: daysAgo(10), minPriceCents: normalPrice, maxPriceCents: normalPrice, closePriceCents: normalPrice },
      { day: daysAgo(5), minPriceCents: hikePrice, maxPriceCents: hikePrice, closePriceCents: hikePrice },
      { day: daysAgo(1), minPriceCents: 10500, maxPriceCents: 10500, closePriceCents: 10500 },
    ];
    const prisma = buildPrismaMock(aggregates);
    const detector = new PreHikeDetector(prisma);

    const result = await detector.detect('offer-1', 10500, normalPrice);

    expect(result.detected).toBe(true);
    expect(result.hikePriceCents).toBe(hikePrice);
  });

  it('nao detecta pre-hike quando o preco caiu de verdade e permanece abaixo do normal', async () => {
    const normalPrice = 20000;
    const aggregates = [
      { day: daysAgo(10), minPriceCents: normalPrice, maxPriceCents: normalPrice, closePriceCents: normalPrice },
      { day: daysAgo(5), minPriceCents: normalPrice, maxPriceCents: normalPrice, closePriceCents: normalPrice },
      { day: daysAgo(1), minPriceCents: 15000, maxPriceCents: 15000, closePriceCents: 15000 },
    ];
    const prisma = buildPrismaMock(aggregates);
    const detector = new PreHikeDetector(prisma);

    const result = await detector.detect('offer-1', 15000, normalPrice);

    expect(result.detected).toBe(false);
  });

  it('nao detecta quando nao ha historico suficiente (retorna nao detectado, nunca falso positivo)', async () => {
    const prisma = buildPrismaMock([]);
    const detector = new PreHikeDetector(prisma);

    const result = await detector.detect('offer-1', 10000, 10000);

    expect(result.detected).toBe(false);
  });

  it('nao detecta quando houve pico mas preco atual nao voltou perto do normal', async () => {
    const normalPrice = 10000;
    const aggregates = [
      { day: daysAgo(10), minPriceCents: normalPrice, maxPriceCents: normalPrice, closePriceCents: normalPrice },
      { day: daysAgo(5), minPriceCents: 15000, maxPriceCents: 15000, closePriceCents: 15000 },
    ];
    const prisma = buildPrismaMock(aggregates);
    const detector = new PreHikeDetector(prisma);

    // Preco atual ficou no meio do caminho — nao e nem o pico nem o normal.
    const result = await detector.detect('offer-1', 12500, normalPrice);

    expect(result.detected).toBe(false);
  });
});
