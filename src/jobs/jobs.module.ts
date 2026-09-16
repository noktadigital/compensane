import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '@/config/app-config.service';
import { ConfigModule } from '@/config/config.module';
import { ProductsModule } from '@/products/products.module';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { DealsModule } from '@/deals/deals.module';
import { ShopeeModule } from '@/marketplaces/shopee/shopee.module';
import { DiscordModule } from '@/discord/discord.module';
import {
  QUEUE_COLLECT_SHOPEE,
  QUEUE_RECORD_PRICES,
  QUEUE_AGGREGATE_DAILY,
} from './jobs.constants';
import { QUEUE_DISCOVER_SHOPEE } from './processors/discover-shopee.processor';
import { CollectShopeeProcessor } from './processors/collect-shopee.processor';
import { DiscoverShopeeProcessor } from './processors/discover-shopee.processor';
import { RecordPricesProcessor } from './processors/record-prices.processor';
import { AggregateDailyProcessor } from './processors/aggregate-daily.processor';
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
    // CADA FILA REGISTRADA AQUI CUSTA ~744 COMANDOS/HORA NO REDIS, PARADA.
    // O worker fica perguntando "tem job novo?" 24/7 mesmo sem trabalho —
    // e o Upstash cobra por requisicao. Nao basta remover o @Processor: a
    // fila registrada sobe worker do mesmo jeito. Foi esse o erro que deixou
    // as filas do Mercado Livre queimando cota mesmo "desligadas".
    //
    // Regra: so registre fila cujo trabalho PRECISA de retry/persistencia.
    // - Mercado Livre: removido (bloqueado por 403, nao coleta nada).
    // - analyze-deals / notify-discord: removidos. Analise e notificacao
    //   rodam direto no RecordPricesProcessor, no mesmo processo — sao
    //   calculo local + 1 chamada HTTP, nao precisam de fila propria.
    // - cleanup-data: removido. Virou uma query diaria no scheduler.
    BullModule.registerQueue(
      { name: QUEUE_COLLECT_SHOPEE },
      { name: QUEUE_DISCOVER_SHOPEE },
      { name: QUEUE_RECORD_PRICES },
      { name: QUEUE_AGGREGATE_DAILY },
    ),
    ProductsModule,
    PriceHistoryModule,
    DealsModule,
    ShopeeModule,
    DiscordModule,
  ],
  providers: [
    CollectShopeeProcessor,
    DiscoverShopeeProcessor,
    RecordPricesProcessor,
    AggregateDailyProcessor,
    JobsSchedulerService,
  ],
})
export class JobsModule {}
