import { Module } from '@nestjs/common';
import { TrackingModule } from '@/tracking/tracking.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TrackingModule],
  controllers: [HealthController],
})
export class HealthModule {}
