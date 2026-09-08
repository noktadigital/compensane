/**
 * Script de demonstracao/debug: dispara analyze:deals manualmente para a
 * oferta de demo, sem esperar o proximo ciclo do scheduler. Uso:
 * npx ts-node -r tsconfig-paths/register scripts/dev/trigger-analyze.ts
 *
 * IMPORTANTE: rode apenas com a aplicacao principal (npm run start:dev/prod)
 * PARADA, para nao competir por conexoes com o Supabase Session Pooler
 * (limite baixo de conexoes simultaneas no plano free).
 *
 * Usa createApplicationContext SEM o JobsModule/scheduler para nao deixar
 * o mock adapter sobrescrever o preco de demonstracao antes da analise.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@/config/config.module';
import { DatabaseModule } from '@/database/database.module';
import { MarketplaceCoreModule } from '@/marketplaces/core/marketplace-core.module';
import { ShopeeModule } from '@/marketplaces/shopee/shopee.module';
import { DealsModule } from '@/deals/deals.module';
import { TelegramModule } from '@/telegram/telegram.module';
import { DealsService } from '@/deals/deals.service';
import { TelegramService } from '@/telegram/telegram.service';
import { AppConfigService } from '@/config/app-config.service';
import { PrismaClient, Marketplace } from '@prisma/client';

@Module({
  imports: [ConfigModule, DatabaseModule, MarketplaceCoreModule, ShopeeModule, DealsModule, TelegramModule],
})
class AnalyzeOnlyModule {}

async function main() {
  const prisma = new PrismaClient();
  const offer = await prisma.productOffer.findUnique({
    where: { marketplace_externalId: { marketplace: Marketplace.SHOPEE, externalId: 'mock-whey-dark-lab-1' } },
  });

  if (!offer) {
    console.error('Oferta de demo nao encontrada. Rode o backfill-demo-history.ts primeiro.');
    await prisma.$disconnect();
    process.exit(1);
  }

  // Reforca o preco de demonstracao logo antes de analisar, para nao competir
  // com o job automatico de coleta. Preco bem abaixo do plateau (~R$199) para
  // garantir score >= PUBLISH_SCORE mesmo com a variacao natural do plateau detector.
  const todayPriceCents = 14900;
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

  await prisma.$disconnect();

  const app = await NestFactory.createApplicationContext(AnalyzeOnlyModule, { logger: ['log', 'warn', 'error'] });

  const dealsService = app.get(DealsService);
  const telegramService = app.get(TelegramService);
  const appConfig = app.get(AppConfigService);

  const result = await dealsService.analyzeOffer(offer.id);

  if (result.discarded || !result.deal) {
    console.log('Oferta descartada:', result.reasons);
  } else {
    console.log('Deal detectado:', {
      score: result.deal.dealScore,
      confidence: result.deal.confidenceScore,
      discountRate: result.deal.discountRate,
    });

    if (result.deal.dealScore >= appConfig.dealRules.publishScore) {
      const dealWithOffer = await dealsService.getDealWithOffer(result.deal.id);
      if (dealWithOffer) {
        await telegramService.sendDealCard(
          dealWithOffer.id,
          {
            title: dealWithOffer.productOffer.product.title,
            priceCents: dealWithOffer.priceCents,
            discountRate: dealWithOffer.discountRate,
            freeShipping: dealWithOffer.freeShipping,
            link: dealWithOffer.productOffer.url,
            ratingStar: dealWithOffer.productOffer.ratingStar,
            dealScore: dealWithOffer.dealScore,
            minPrice90dCents: dealWithOffer.minPrice90dCents,
            commissionCents: dealWithOffer.commissionCents,
          },
          dealWithOffer.productOffer.imageUrl,
        );
        console.log('Card enviado ao Telegram!');
      }
    } else {
      console.log(`Score ${result.deal.dealScore} abaixo do minimo de publicacao (${appConfig.dealRules.publishScore})`);
    }
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
