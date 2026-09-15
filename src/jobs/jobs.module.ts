import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '@/config/app-config.service';
import { ConfigModule } from '@/config/config.module';
import { ProductsModule } from '@/products/products.module';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { DealsModule } from '@/deals/deals.module';
import { ShopeeModule } from '@/marketplaces/shopee/shopee.module';
import { MercadoLivreModule } from '@/marketplaces/mercado-livre/mercado-livre.module';
import { DiscordModule } from '@/discord/discord.module';
import {
  QUEUE_COLLECT_SHOPEE,
  QUEUE_COLLECT_MERCADO_LIVRE,
  QUEUE_RECORD_PRICES,
  QUEUE_AGGREGATE_DAILY,
  QUEUE_ANALYZE_DEALS,
  QUEUE_NOTIFY_DISCORD,
  QUEUE_CLEANUP_DATA,
} from './jobs.constants';
import { QUEUE_DISCOVER_SHOPEE } from './processors/discover-shopee.processor';
import { QUEUE_DISCOVER_MERCADO_LIVRE } from './processors/discover-mercado-livre.processor';
import { CollectShopeeProcessor } from './processors/collect-shopee.processor';
import { DiscoverShopeeProcessor } from './processors/discover-shopee.processor';
import { CollectMercadoLivreProcessor } from './processors/collect-mercado-livre.processor';
import { DiscoverMercadoLivreProcessor } from './processors/discover-mercado-livre.processor';
import { RecordPricesProcessor } from './processors/record-prices.processor';
import { AnalyzeDealsProcessor } from './processors/analyze-deals.processor';
import { NotifyDiscordProcessor } from './processors/notify-discord.processor';
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
      { name: QUEUE_COLLECT_MERCADO_LIVRE },
      { name: QUEUE_DISCOVER_MERCADO_LIVRE },
      { name: QUEUE_RECORD_PRICES },
      { name: QUEUE_AGGREGATE_DAILY },
      { name: QUEUE_ANALYZE_DEALS },
      { name: QUEUE_NOTIFY_DISCORD },
      { name: QUEUE_CLEANUP_DATA },
    ),
    ProductsModule,
    PriceHistoryModule,
    DealsModule,
    ShopeeModule,
    MercadoLivreModule,
    DiscordModule,
  ],
  providers: [
    CollectShopeeProcessor,
    DiscoverShopeeProcessor,
    CollectMercadoLivreProcessor,
    DiscoverMercadoLivreProcessor,
    RecordPricesProcessor,
    AnalyzeDealsProcessor,
    NotifyDiscordProcessor,
    AggregateDailyProcessor,
    CleanupDataProcessor,
    JobsSchedulerService,
  ],
})
export class JobsModule {}
