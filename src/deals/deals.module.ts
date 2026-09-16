import { Module } from '@nestjs/common';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { DealScoringService } from './deal-scoring.service';
import { PreHikeDetector } from './pre-hike-detector.service';
import { EvScoringService } from './ev-scoring.service';
import { DealsService } from './deals.service';
import { MaturityCriteriaService } from './maturity-criteria.service';

@Module({
  imports: [PriceHistoryModule],
  providers: [
    DealScoringService,
    PreHikeDetector,
    EvScoringService,
    MaturityCriteriaService,
    DealsService,
  ],
  exports: [
    DealScoringService,
    PreHikeDetector,
    EvScoringService,
    MaturityCriteriaService,
    DealsService,
  ],
})
export class DealsModule {}
