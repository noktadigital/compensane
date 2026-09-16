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
    // NOTA: cada fila registrada aqui sobe um worker que faz polling no Redis
    // 24/7, mesmo sem job nenhum. Com o Upstash cobrando por requisicao, fila
    // registrada e custo fixo — so registre fila que tem trabalho real.
    // As filas do Mercado Livre continuam declaradas (o scheduler ainda as
    // injeta) mas seus PROCESSORS nao sao registrados enquanto o ML estiver
    // bloqueado: sem worker, a fila nao consome nada ociosa.
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
    RecordPricesProcessor,
    AnalyzeDealsProcessor,
    NotifyDiscordProcessor,
    AggregateDailyProcessor,
    CleanupDataProcessor,
    JobsSchedulerService,
    // Os processors do Mercado Livre so sao registrados quando o ML esta em
    // modo "live". Em mock eles nao teriam trabalho real, mas cada um subiria
    // um worker fazendo polling no Redis 24/7 — 2 dos 9 workers que
    // esgotaram a cota do Upstash sem produzir um unico dado util.
    ...(process.env.MERCADO_LIVRE_MODE === 'live'
      ? [CollectMercadoLivreProcessor, DiscoverMercadoLivreProcessor]
      : []),
  ],
})
export class JobsModule {}
