import { Controller, Get } from '@nestjs/common';
import { TrackingService } from '@/tracking/tracking.service';

@Controller()
export class HealthController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('metrics')
  async metrics() {
    return this.trackingService.getBasicMetrics();
  }
}
