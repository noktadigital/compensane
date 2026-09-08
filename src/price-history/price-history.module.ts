import { Module } from '@nestjs/common';
import { PriceRecordingService } from './price-recording.service';
import { PriceAggregationService } from './price-aggregation.service';
import { PriceStatisticsService } from './price-statistics.service';
import { PriceReferenceService } from './price-reference.service';
import { ConfidenceScoreService } from './confidence-score.service';

@Module({
  providers: [
    PriceRecordingService,
    PriceAggregationService,
    PriceStatisticsService,
    PriceReferenceService,
    ConfidenceScoreService,
  ],
  exports: [
    PriceRecordingService,
    PriceAggregationService,
    PriceStatisticsService,
    PriceReferenceService,
    ConfidenceScoreService,
  ],
})
export class PriceHistoryModule {}
