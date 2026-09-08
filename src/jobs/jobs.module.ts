import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '@/config/app-config.service';
import { ConfigModule } from '@/config/config.module';
import { ProductsModule } from '@/products/products.module';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { DealsModule } from '@/deals/deals.module';
import { ShopeeModule } from '@/marketplaces/shopee/shopee.module';
import { TelegramModule } from '@/telegram/telegram.module';
import {
  QUEUE_COLLECT_SHOPEE,
  QUEUE_RECORD_PRICES,
  QUEUE_AGGREGATE_DAILY,
  QUEUE_ANALYZE_DEALS,
  QUEUE_NOTIFY_TELEGRAM,
  QUEUE_CLEANUP_DATA,
} from './jobs.constants';
import { QUEUE_DISCOVER_SHOPEE } from './processors/discover-shopee.processor';
import { CollectShopeeProcessor } from './processors/collect-shopee.processor';
import { DiscoverShopeeProcessor } from './processors/discover-shopee.processor';
import { RecordPricesProcessor } from './processors/record-prices.processor';
import { AnalyzeDealsProcessor } from './processors/analyze-deals.processor';
import { NotifyTelegramProcessor } from './processors/notify-telegram.processor';
import { AggregateDailyProcessor } from './processors/aggregate-daily.processor';
import { CleanupDataProcessor } from './processors/cleanup-data.processor';
import { JobsSchedulerService } from './jobs-scheduler.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        connection: { url: appConfig.redisUrl },
        defaultJobOptions: {
          // Protecao padrao contra bombardeio de API / falhas transitorias (secao 19).
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_COLLECT_SHOPEE },
      { name: QUEUE_DISCOVER_SHOPEE },
      { name: QUEUE_RECORD_PRICES },
      { name: QUEUE_AGGREGATE_DAILY },
      { name: QUEUE_ANALYZE_DEALS },
      { name: QUEUE_NOTIFY_TELEGRAM },
      { name: QUEUE_CLEANUP_DATA },
    ),
    ProductsModule,
    PriceHistoryModule,
    DealsModule,
    ShopeeModule,
    TelegramModule,
  ],
  providers: [
    CollectShopeeProcessor,
    DiscoverShopeeProcessor,
    RecordPricesProcessor,
    AnalyzeDealsProcessor,
    NotifyTelegramProcessor,
    AggregateDailyProcessor,
    CleanupDataProcessor,
    JobsSchedulerService,
  ],
})
export class JobsModule {}
