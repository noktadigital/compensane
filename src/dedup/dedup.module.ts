import { Module } from '@nestjs/common';
import { DeduplicationService } from './deduplication.service';

@Module({
  providers: [DeduplicationService],
  exports: [DeduplicationService],
})
export class DedupModule {}
