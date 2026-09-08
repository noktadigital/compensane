import { Injectable } from '@nestjs/common';
import { Marketplace } from '@prisma/client';
import { MarketplaceAdapter } from './marketplace-adapter.interface';

/**
 * Registro central de adapters disponiveis. Novos marketplaces (TikTok, Amazon,
 * Mercado Livre) se registram aqui sem que o core precise conhece-los.
 */
@Injectable()
export class MarketplaceAdapterRegistry {
  private readonly adapters = new Map<Marketplace, MarketplaceAdapter>();

  register(adapter: MarketplaceAdapter): void {
    this.adapters.set(adapter.marketplace, adapter);
  }

  get(marketplace: Marketplace): MarketplaceAdapter {
    const adapter = this.adapters.get(marketplace);
    if (!adapter) {
      throw new Error(`Nenhum adapter registrado para o marketplace ${marketplace}`);
    }
    return adapter;
  }

  getAll(): MarketplaceAdapter[] {
    return Array.from(this.adapters.values());
  }
}
