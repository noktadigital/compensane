import { Module } from '@nestjs/common';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { DealScoringService } from './deal-scoring.service';
import { PreHikeDetector } from './pre-hike-detector.service';
import { EvScoringService } from './ev-scoring.service';
import { DealsService } from './deals.service';

@Module({
  imports: [PriceHistoryModule],
  providers: [DealScoringService, PreHikeDetector, EvScoringService, DealsService],
  exports: [DealScoringService, PreHikeDetector, EvScoringService, DealsService],
})
export class DealsModule {}
