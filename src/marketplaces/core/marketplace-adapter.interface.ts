import { Marketplace } from '@prisma/client';

/**
 * Representa um produto/oferta exatamente como retornado pelo marketplace,
 * antes de qualquer normalizacao. Cada adapter mapeia sua resposta nativa
 * para esta forma comum.
 */
export interface RawMarketplaceOffer {
  marketplace: Marketplace;
  externalId: string; // itemId do marketplace
  externalShopId?: string;
  sellerName?: string;
  title: string;
  url: string;
  imageUrl?: string;
  priceCents: number;
  originalPriceCents?: number;
  shippingCents?: number;
  freeShipping?: boolean;
  discountRate?: number;
  commissionRateBp?: number; // basis points
  commissionCents?: number;
  inStock: boolean;
  ratingStar?: number;
  ratingCount?: number;
  salesCount?: number;
  gtin?: string;
  brand?: string;
  category?: string;
  raw?: unknown; // payload original, para depuracao/auditoria
}

export interface AffiliateLinkResult {
  originalLink: string;
  shortLink?: string;
  subId?: string;
}

export interface SearchOffersParams {
  keyword: string;
  page?: number;
  pageSize?: number;
}

/** Categoria de ofertas do marketplace (ex: "Home Appliances"). */
export interface MarketplaceCategory {
  id: string;
  name: string;
}

export interface BrowseCategoryParams {
  categoryId: string;
  page?: number;
  pageSize?: number;
}

export interface GetOffersByIdsParams {
  externalIds: string[];
}

/**
 * Contrato que todo marketplace de afiliados deve implementar.
 * O core do sistema (collectors, normalizer, analysis engine) so conhece
 * esta interface — nunca detalhes especificos de Shopee/TikTok/Amazon/ML.
 */
export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;

  /** Busca produtos por palavra-chave (descoberta, secao 21). */
  searchOffers(params: SearchOffersParams): Promise<RawMarketplaceOffer[]>;

  /** Busca o estado atual de ofertas ja conhecidas (polling, secao 20). */
  getOffersByIds(params: GetOffersByIdsParams): Promise<RawMarketplaceOffer[]>;

  /** Gera (ou recupera) o link de afiliado para uma oferta, quando suportado pela API. */
  generateAffiliateLink(offer: RawMarketplaceOffer): Promise<AffiliateLinkResult>;

  /**
   * Categorias de oferta do marketplace, quando a API expoe.
   *
   * Descoberta por categoria cobre o catalogo inteiro sem depender de
   * adivinhar palavra-chave — o que evita o problema de "whey protein"
   * retornar shampoo capilar, ja que a busca textual casa qualquer titulo
   * que cite o termo.
   */
  listCategories?(): Promise<MarketplaceCategory[]>;

  /** Ofertas de uma categoria. So existe quando listCategories existe. */
  browseCategory?(params: BrowseCategoryParams): Promise<RawMarketplaceOffer[]>;
}

export const MARKETPLACE_ADAPTER_REGISTRY = 'MARKETPLACE_ADAPTER_REGISTRY';
