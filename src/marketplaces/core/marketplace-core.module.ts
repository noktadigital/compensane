import { Global, Module } from '@nestjs/common';
import { MarketplaceAdapterRegistry } from './marketplace-adapter.registry';

@Global()
@Module({
  providers: [MarketplaceAdapterRegistry],
  exports: [MarketplaceAdapterRegistry],
})
export class MarketplaceCoreModule {}
