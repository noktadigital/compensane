import { Module, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';
import { MarketplaceAdapterRegistry } from '../core/marketplace-adapter.registry';
import { ShopeeMockAdapter } from './shopee-mock.adapter';
import { ShopeeLiveAdapter } from './shopee-live.adapter';
import { MarketplaceAdapter } from '../core/marketplace-adapter.interface';

export const SHOPEE_ADAPTER = 'SHOPEE_ADAPTER';

@Module({
  providers: [
    ShopeeMockAdapter,
    ShopeeLiveAdapter,
    {
      provide: SHOPEE_ADAPTER,
      useFactory: (
        appConfig: AppConfigService,
        mock: ShopeeMockAdapter,
        live: ShopeeLiveAdapter,
      ): MarketplaceAdapter => (appConfig.shopee.mode === 'live' ? live : mock),
      inject: [AppConfigService, ShopeeMockAdapter, ShopeeLiveAdapter],
    },
  ],
  exports: [SHOPEE_ADAPTER],
})
export class ShopeeModule implements OnModuleInit {
  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly appConfig: AppConfigService,
    private readonly mock: ShopeeMockAdapter,
    private readonly live: ShopeeLiveAdapter,
  ) {}

  onModuleInit() {
    const adapter = this.appConfig.shopee.mode === 'live' ? this.live : this.mock;
    this.registry.register(adapter);
  }
}
