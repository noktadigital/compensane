import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppConfigService } from '@/config/app-config.service';
import { ConfigModule } from '@/config/config.module';
import { DealsModule } from '@/deals/deals.module';
import { TrackingModule } from '@/tracking/tracking.module';
import { PostsModule } from '@/posts/posts.module';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { TrackingMetricsFormatter } from './tracking-metrics.formatter';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        token: appConfig.telegram.botToken || 'MISSING_TOKEN',
        launchOptions: false,
      }),
    }),
    DealsModule,
    TrackingModule,
    PostsModule,
  ],
  providers: [TelegramService, TelegramUpdate, TrackingMetricsFormatter],
  exports: [TelegramService],
})
export class TelegramModule {}
