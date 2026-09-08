import { Module } from '@nestjs/common';
import { TrackingModule } from '@/tracking/tracking.module';
import { RedirectController } from './redirect.controller';

@Module({
  imports: [TrackingModule],
  controllers: [RedirectController],
})
export class RedirectModule {}
