import { Module } from '@nestjs/common';
import { ConfigModule } from '@/config/config.module';
import { DealsModule } from '@/deals/deals.module';
import { TrackingModule } from '@/tracking/tracking.module';
import { PostsModule } from '@/posts/posts.module';
import { DiscordClientService } from './discord-client.service';
import { DiscordInteractionService } from './discord-interaction.service';
import { DealEmbedBuilder } from './deal-embed.builder';
import { TrackingMetricsFormatter } from './tracking-metrics.formatter';

@Module({
  imports: [ConfigModule, DealsModule, TrackingModule, PostsModule],
  providers: [
    DiscordClientService,
    DiscordInteractionService,
    DealEmbedBuilder,
    TrackingMetricsFormatter,
  ],
  exports: [DiscordClientService],
})
export class DiscordModule {}
