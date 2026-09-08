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
  commissionRateBp: number;
  ratingStar: number;
  ratingCount: number;
  salesCount: number;
  shopId: string;
  sellerName: string;
  category: string;
  /** Amplitude de variacao aleatoria de preco a cada chamada, em % do base price. */
  volatility: number;
  /** Se true, simula uma oferta com pico artificial recente seguido de queda (pre-hike). */
  simulatePreHike?: boolean;
}

/**
 * Catalogo simulado fixo, cobrindo os cenarios descritos no briefing:
 * desconto real, falso desconto (pre-hike), pouco historico, sem estoque,
 * comissao alta, frete gratis. Permite rodar o pipeline completo localmente
 * sem credenciais reais da Shopee.
 */
const MOCK_CATALOG: MockCatalogEntry[] = [
  {
    externalId: 'mock-whey-dark-lab-1',
    title: 'Whey Dark Lab Isolate Protein Fuse 1,8kg',
    basePriceCents: 17090,
    imageUrl: 'https://picsum.photos/seed/whey-dark-lab/600/600',
    commissionRateBp: 800,
    ratingStar: 4.8,
    ratingCount: 1240,
    salesCount: 5300,
    shopId: 'shop-100',
    sellerName: 'Dark Lab Suplementos',
    category: 'suplementos',
    volatility: 0.02,
  },
  {
    externalId: 'mock-air-fryer-1',
    title: 'Air Fryer Mondial 4L Digital Inox',
    basePriceCents: 24900,
    imageUrl: 'https://picsum.photos/seed/air-fryer/600/600',
    commissionRateBp: 600,
    ratingStar: 4.6,
    ratingCount: 3400,
    salesCount: 12000,
    shopId: 'shop-101',
    sellerName: 'Mondial Oficial',
    category: 'eletroportateis',
    volatility: 0.015,
  },
  {
    externalId: 'mock-fone-bt-fakehike-1',
    title: 'Fone de Ouvido Bluetooth TWS Pro X',
    basePriceCents: 8990,
    imageUrl: 'https://picsum.photos/seed/fone-bt/600/600',
    commissionRateBp: 1500,
    ratingStar: 4.3,
    ratingCount: 890,
    salesCount: 4100,
    shopId: 'shop-102',
    sellerName: 'TechStore BR',
    category: 'eletronicos',
    volatility: 0.01,
    simulatePreHike: true,
  },
  {
    externalId: 'mock-creatina-newcomer-1',
    title: 'Creatina Monohidratada 300g Growth',
    basePriceCents: 6490,
    imageUrl: 'https://picsum.photos/seed/creatina/600/600',
    commissionRateBp: 700,
    ratingStar: 4.9,
    ratingCount: 210,
    salesCount: 980,
    shopId: 'shop-103',
    sellerName: 'Growth Suplementos',
    category: 'suplementos',
    volatility: 0.03,
  },
  {
    externalId: 'mock-ssd-1tb-1',
    title: 'SSD 1TB NVMe M.2 Kingston NV2',
    basePriceCents: 29900,
    imageUrl: 'https://picsum.photos/seed/ssd-1tb/600/600',
    commissionRateBp: 400,
    ratingStar: 4.7,
    ratingCount: 5600,
    salesCount: 21000,
    shopId: 'shop-104',
    sellerName: 'Kingston Store',
    category: 'informatica',
    volatility: 0.02,
  },
];

@Injectable()
export class ShopeeMockAdapter implements MarketplaceAdapter {
  readonly marketplace = Marketplace.SHOPEE;
  private readonly logger = new Logger(ShopeeMockAdapter.name);

  /** Semente deterministica por externalId + dia, para observacoes reprodutiveis dentro do mesmo dia. */
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

    let priceCents = Math.round(entry.basePriceCents * (1 + (rand - 0.5) * entry.volatility * 2));
    let originalPriceCents: number | undefined;

    if (entry.simulatePreHike) {
      // Simula: preco normal -> pico artificial ha poucos dias -> queda "de volta ao normal"
      // exibida como desconto grande, mas que o PreHikeDetector deve identificar.
      const hikeFactor = 1.65;
      originalPriceCents = Math.round(entry.basePriceCents * hikeFactor);
      priceCents = Math.round(entry.basePriceCents * 1.02);
    }

    const commissionCents = Math.round((priceCents * entry.commissionRateBp) / 10000);
    const inStock = this.seededRandom(`${entry.externalId}-stock`) > 0.05;

    return {
      marketplace: Marketplace.SHOPEE,
      externalId: entry.externalId,
      externalShopId: entry.shopId,
      sellerName: entry.sellerName,
      title: entry.title,
      url: `https://shopee.com.br/product/${entry.shopId}/${entry.externalId}`,
      imageUrl: entry.imageUrl,
      priceCents,
      originalPriceCents,
      shippingCents: 0,
      freeShipping: true,
      commissionRateBp: entry.commissionRateBp,
      commissionCents,
      inStock,
      ratingStar: entry.ratingStar,
      ratingCount: entry.ratingCount,
      salesCount: entry.salesCount,
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

  /** Exposto para seeds/testes que precisem do catalogo completo. */
  static getCatalog(): MockCatalogEntry[] {
    return MOCK_CATALOG;
  }
}
