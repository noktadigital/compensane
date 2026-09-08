import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { MarketplaceCoreModule } from './marketplaces/core/marketplace-core.module';
import { ShopeeModule } from './marketplaces/shopee/shopee.module';
import { ProductsModule } from './products/products.module';
import { PriceHistoryModule } from './price-history/price-history.module';
import { DealsModule } from './deals/deals.module';
import { PostsModule } from './posts/posts.module';
import { TrackingModule } from './tracking/tracking.module';
import { TelegramModule } from './telegram/telegram.module';
import { JobsModule } from './jobs/jobs.module';
import { RedirectModule } from './redirect/redirect.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MarketplaceCoreModule,
    ShopeeModule,
    ProductsModule,
    PriceHistoryModule,
    DealsModule,
    PostsModule,
    TrackingModule,
    TelegramModule,
    JobsModule,
    RedirectModule,
    HealthModule,
  ],
})
export class AppModule {}
