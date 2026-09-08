/**
 * Script de demonstracao (nao faz parte do pipeline de producao): popula
 * historico de preco retroativo para a oferta mock-whey-dark-lab-1, para
 * que o Deal Score tenha confianca suficiente e o card apareca no Telegram
 * na primeira execucao manual local. Uso: npx ts-node -r tsconfig-paths/register scripts/dev/backfill-demo-history.ts
 */
import { PrismaClient, Marketplace, PollingTier } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const externalId = 'mock-whey-dark-lab-1';

  const product = await prisma.product.upsert({
    where: { normalizedKey: 'demo:whey-dark-lab' },
    create: {
      title: 'Whey Dark Lab Isolate Protein Fuse 1,8kg',
      normalizedKey: 'demo:whey-dark-lab',
      category: 'suplementos',
      imageUrl: 'https://picsum.photos/seed/whey-dark-lab/600/600',
    },
    update: {},
  });

  const offer = await prisma.productOffer.upsert({
    where: { marketplace_externalId: { marketplace: Marketplace.SHOPEE, externalId } },
    create: {
      productId: product.id,
      marketplace: Marketplace.SHOPEE,
      externalId,
      externalShopId: 'shop-100',
      sellerName: 'Dark Lab Suplementos',
      url: `https://shopee.com.br/product/shop-100/${externalId}`,
      imageUrl: 'https://picsum.photos/seed/whey-dark-lab/600/600',
      ratingStar: 4.8,
      ratingCount: 1240,
      salesCount: 5300,
      commissionRateBp: 800,
      pollingTier: PollingTier.HOT,
      lastCollectedAt: new Date(),
    },
    update: {},
  });

  // 90 dias de preco estavel em R$ 199,90 (plateau), simulando o "preco normal".
  const normalPriceCents = 19990;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  for (let i = 90; i >= 1; i--) {
    const day = new Date(now - i * DAY);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));

    // Pequena variacao de +-1% para simular ruido realista em torno do plateau.
    const noise = Math.round(normalPriceCents * (Math.random() * 0.02 - 0.01));
    const priceCents = normalPriceCents + noise;

    await prisma.priceObservation.create({
      data: {
        productOfferId: offer.id,
        source: Marketplace.SHOPEE,
        observedAt: new Date(dayStart.getTime() + 12 * 60 * 60 * 1000),
        priceCents,
        shippingCents: 0,
        commissionCents: Math.round((priceCents * 800) / 10000),
        inStock: true,
      },
    });

    await prisma.dailyPriceAggregate.upsert({
      where: { productOfferId_day: { productOfferId: offer.id, day: dayStart } },
      create: {
        productOfferId: offer.id,
        source: Marketplace.SHOPEE,
        day: dayStart,
        minPriceCents: priceCents,
        maxPriceCents: priceCents,
        closePriceCents: priceCents,
        observationsCount: 1,
      },
      update: {
        minPriceCents: priceCents,
        maxPriceCents: priceCents,
        closePriceCents: priceCents,
        observationsCount: 1,
      },
    });
  }

  // Observacao de HOJE: preco caiu para R$ 170,90 (24% abaixo do plateau) - a oferta real.
  const todayPriceCents = 17090;
  await prisma.priceObservation.create({
    data: {
      productOfferId: offer.id,
      source: Marketplace.SHOPEE,
      observedAt: new Date(),
      priceCents: todayPriceCents,
      shippingCents: 0,
      commissionCents: Math.round((todayPriceCents * 800) / 10000),
      inStock: true,
    },
  });

  const todayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  await prisma.dailyPriceAggregate.upsert({
    where: { productOfferId_day: { productOfferId: offer.id, day: todayStart } },
    create: {
      productOfferId: offer.id,
      source: Marketplace.SHOPEE,
      day: todayStart,
      minPriceCents: todayPriceCents,
      maxPriceCents: todayPriceCents,
      closePriceCents: todayPriceCents,
      observationsCount: 1,
    },
    update: {
      minPriceCents: todayPriceCents,
      maxPriceCents: todayPriceCents,
      closePriceCents: todayPriceCents,
      observationsCount: 1,
    },
  });

  console.log(`Historico de demonstracao criado para oferta ${offer.id} (${externalId})`);
  console.log(`Rode a analise manual para essa oferta ou aguarde o proximo ciclo de record:prices/analyze:deals.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
