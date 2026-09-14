import { Module, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';
import { MarketplaceAdapterRegistry } from '../core/marketplace-adapter.registry';
import { MercadoLivreMockAdapter } from './mercado-livre-mock.adapter';
import { MercadoLivreLiveAdapter } from './mercado-livre-live.adapter';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { MercadoLivreAuthController } from './mercado-livre-auth.controller';
import { MarketplaceAdapter } from '../core/marketplace-adapter.interface';

export const MERCADO_LIVRE_ADAPTER = 'MERCADO_LIVRE_ADAPTER';

@Module({
  controllers: [MercadoLivreAuthController],
  providers: [
    MercadoLivreOAuthService,
    MercadoLivreMockAdapter,
    MercadoLivreLiveAdapter,
    {
      provide: MERCADO_LIVRE_ADAPTER,
      useFactory: (
        appConfig: AppConfigService,
        mock: MercadoLivreMockAdapter,
        live: MercadoLivreLiveAdapter,
      ): MarketplaceAdapter => (appConfig.mercadoLivre.mode === 'live' ? live : mock),
      inject: [AppConfigService, MercadoLivreMockAdapter, MercadoLivreLiveAdapter],
    },
  ],
  exports: [MERCADO_LIVRE_ADAPTER, MercadoLivreOAuthService],
})
export class MercadoLivreModule implements OnModuleInit {
  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly appConfig: AppConfigService,
    private readonly mock: MercadoLivreMockAdapter,
    private readonly live: MercadoLivreLiveAdapter,
  ) {}

  onModuleInit() {
    const adapter = this.appConfig.mercadoLivre.mode === 'live' ? this.live : this.mock;
    this.registry.register(adapter);
  }
}
