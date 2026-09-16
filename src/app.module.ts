import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { MarketplaceCoreModule } from './marketplaces/core/marketplace-core.module';
import { ShopeeModule } from './marketplaces/shopee/shopee.module';
import { MercadoLivreModule } from './marketplaces/mercado-livre/mercado-livre.module';
import { ProductsModule } from './products/products.module';
import { PriceHistoryModule } from './price-history/price-history.module';
import { DealsModule } from './deals/deals.module';
import { PostsModule } from './posts/posts.module';
import { TrackingModule } from './tracking/tracking.module';
import { DiscordModule } from './discord/discord.module';
import { JobsModule } from './jobs/jobs.module';
import { RedirectModule } from './redirect/redirect.module';
import { InsightsModule } from './insights/insights.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MarketplaceCoreModule,
    ShopeeModule,
    MercadoLivreModule,
    ProductsModule,
    PriceHistoryModule,
    DealsModule,
    PostsModule,
    TrackingModule,
    DiscordModule,
    JobsModule,
    RedirectModule,
    InsightsModule,
    HealthModule,
  ],
})
export class AppModule {}
