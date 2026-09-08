import { PrismaClient, Marketplace } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const offer = await prisma.productOffer.findUnique({
    where: { marketplace_externalId: { marketplace: Marketplace.SHOPEE, externalId: 'mock-whey-dark-lab-1' } },
  });
  if (!offer) {
    console.log('Oferta nao encontrada');
    return;
  }

  const lastObs = await prisma.priceObservation.findMany({
    where: { productOfferId: offer.id },
    orderBy: { observedAt: 'desc' },
    take: 5,
  });

  const aggCount = await prisma.dailyPriceAggregate.count({ where: { productOfferId: offer.id } });

  console.log('Offer:', { id: offer.id, tier: offer.pollingTier });
  console.log('Ultimas observacoes:', lastObs.map(o => ({ price: o.priceCents, at: o.observedAt })));
  console.log('Total de agregacoes diarias:', aggCount);
}

main().finally(() => prisma.$disconnect());
