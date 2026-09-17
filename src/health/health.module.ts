import { Module } from '@nestjs/common';
import { TrackingModule } from '@/tracking/tracking.module';
import { ConfigModule } from '@/config/config.module';
import { HealthController } from './health.controller';
import { KeepAliveService } from './keep-alive.service';

@Module({
  imports: [TrackingModule, ConfigModule],
  controllers: [HealthController],
  providers: [KeepAliveService],
})
export class HealthModule {}
