import { Injectable, Logger } from '@nestjs/common';
import { Marketplace } from '@prisma/client';
import {
  AffiliateLinkResult,
  GetOffersByIdsParams,
  MarketplaceAdapter,
  RawMarketplaceOffer,
  SearchOffersParams,
} from '../core/marketplace-adapter.interface';

interface MockCatalogEntry {
  externalId: string;
  title: string;
  basePriceCents: number;
  imageUrl: string;
  sellerId: string;
  sellerName: string;
  category: string;
  volatility: number;
}

/**
 * Catalogo simulado do Mercado Livre, no mesmo padrao do ShopeeMockAdapter.
 * Permite rodar o pipeline completo sem depender do fluxo OAuth real ou de
 * disponibilidade dos endpoints publicos (que tem restricoes conhecidas —
 * ver mercado-livre-live.adapter.ts).
 */
const MOCK_CATALOG: MockCatalogEntry[] = [
  {
    externalId: 'MLB-mock-fone-1',
    title: 'Fone Bluetooth JBL Tune 510BT',
    basePriceCents: 24900,
    imageUrl: 'https://picsum.photos/seed/ml-fone/600/600',
    sellerId: 'seller-ml-1',
    sellerName: 'JBL Oficial',
    category: 'eletronicos',
    volatility: 0.02,
  },
  {
    externalId: 'MLB-mock-panela-1',
    title: 'Panela de Pressão Elétrica Digital 5L',
    basePriceCents: 34900,
    imageUrl: 'https://picsum.photos/seed/ml-panela/600/600',
    sellerId: 'seller-ml-2',
    sellerName: 'Casa & Cozinha',
    category: 'casa',
    volatility: 0.015,
  },
  {
    externalId: 'MLB-mock-mouse-1',
    title: 'Mouse Gamer Logitech G203',
    basePriceCents: 12900,
    imageUrl: 'https://picsum.photos/seed/ml-mouse/600/600',
    sellerId: 'seller-ml-3',
    sellerName: 'Logitech Store',
    category: 'informatica',
    volatility: 0.02,
  },
];

@Injectable()
export class MercadoLivreMockAdapter implements MarketplaceAdapter {
  readonly marketplace = Marketplace.MERCADO_LIVRE;
  private readonly logger = new Logger(MercadoLivreMockAdapter.name);

  private seededRandom(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash) % 10000) / 10000;
  }

  private buildOffer(entry: MockCatalogEntry): RawMarketplaceOffer {
    const now = new Date();
    const daySeed = `${entry.externalId}-${now.toISOString().slice(0, 10)}-${now.getHours()}`;
    const rand = this.seededRandom(daySeed);
    const priceCents = Math.round(entry.basePriceCents * (1 + (rand - 0.5) * entry.volatility * 2));
    const inStock = this.seededRandom(`${entry.externalId}-stock`) > 0.05;

    return {
      marketplace: Marketplace.MERCADO_LIVRE,
      externalId: entry.externalId,
      externalShopId: entry.sellerId,
      sellerName: entry.sellerName,
      title: entry.title,
      url: `https://produto.mercadolivre.com.br/${entry.externalId}`,
      imageUrl: entry.imageUrl,
      priceCents,
      shippingCents: 0,
      freeShipping: true,
      inStock,
      category: entry.category,
      raw: { mock: true, entry },
    };
  }

  async searchOffers(params: SearchOffersParams): Promise<RawMarketplaceOffer[]> {
    this.logger.debug(`[mock] searchOffers keyword="${params.keyword}"`);
    const matches = MOCK_CATALOG.filter(
      (entry) =>
        entry.title.toLowerCase().includes(params.keyword.toLowerCase()) ||
        entry.category.toLowerCase().includes(params.keyword.toLowerCase()),
    );
    const pool = matches.length > 0 ? matches : MOCK_CATALOG;
    return pool.map((entry) => this.buildOffer(entry));
  }

  async getOffersByIds(params: GetOffersByIdsParams): Promise<RawMarketplaceOffer[]> {
    return MOCK_CATALOG.filter((entry) => params.externalIds.includes(entry.externalId)).map(
      (entry) => this.buildOffer(entry),
    );
  }

  async generateAffiliateLink(offer: RawMarketplaceOffer): Promise<AffiliateLinkResult> {
    return {
      originalLink: offer.url,
      shortLink: `${offer.url}?af_mock=1`,
      subId: 'achadinhos',
    };
  }
}
