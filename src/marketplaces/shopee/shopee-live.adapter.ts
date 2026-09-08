import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Marketplace } from '@prisma/client';
import { AppConfigService } from '@/config/app-config.service';
import {
  AffiliateLinkResult,
  GetOffersByIdsParams,
  MarketplaceAdapter,
  RawMarketplaceOffer,
  SearchOffersParams,
} from '../core/marketplace-adapter.interface';
import { buildShopeeAuthHeader } from './shopee-signature.util';

/**
 * Adapter para a Shopee Affiliate Open API (GraphQL).
 *
 * IMPORTANTE: a Shopee versiona e restringe o acesso a esta API por conta
 * de afiliado aprovada. Os nomes de operacao abaixo (productOfferV2,
 * shopOfferV2, generateShortLink, conversionReport) refletem o que a
 * documentacao publica descreve, mas o schema GraphQL exato (campos
 * disponiveis, paginacao, tipos) so pode ser confirmado com uma conta e
 * credenciais reais. Antes de ir para producao:
 *   1. Validar o schema via introspeccao GraphQL com credenciais reais.
 *   2. Ajustar os campos de `buildXxxQuery` conforme a resposta real.
 *   3. Tratar paginacao (cursor) de acordo com o retorno da API.
 *
 * Ate la, use SHOPEE_MODE=mock (ShopeeMockAdapter) para desenvolvimento.
 */
@Injectable()
export class ShopeeLiveAdapter implements MarketplaceAdapter {
  readonly marketplace = Marketplace.SHOPEE;
  private readonly logger = new Logger(ShopeeLiveAdapter.name);

  constructor(private readonly appConfig: AppConfigService) {}

  private async graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const { appId, appSecret, apiBaseUrl } = this.appConfig.shopee;

    if (!appId || !appSecret) {
      throw new Error(
        'SHOPEE_APP_ID/SHOPEE_APP_SECRET nao configurados. Defina SHOPEE_MODE=mock para desenvolvimento local.',
      );
    }

    const payload = JSON.stringify({ query, variables });
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = buildShopeeAuthHeader({ appId, appSecret, timestamp, payload });

    const response = await fetch(apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: payload,
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Shopee API respondeu ${response.status}: ${text}`);
      throw new HttpException(`Shopee API error: ${response.status}`, response.status);
    }

    const json = (await response.json()) as { data?: T; errors?: unknown[] };
    if (json.errors && json.errors.length > 0) {
      this.logger.error(`Shopee API GraphQL errors: ${JSON.stringify(json.errors)}`);
      throw new Error('Shopee API retornou erros GraphQL');
    }

    return json.data as T;
  }

  async searchOffers(params: SearchOffersParams): Promise<RawMarketplaceOffer[]> {
    // Operacao productOfferV2 — busca de ofertas por palavra-chave.
    const query = `
      query ProductOfferV2($keyword: String, $page: Int, $limit: Int) {
        productOfferV2(keyword: $keyword, page: $page, limit: $limit) {
          nodes {
            itemId
            shopId
            productName
            imageUrl
            price
            priceMin
            priceMax
            commissionRate
            commission
            sales
            ratingStar
            productLink
            offerLink
          }
        }
      }
    `;

    const data = await this.graphqlRequest<{
      productOfferV2: { nodes: Record<string, any>[] };
    }>(query, {
      keyword: params.keyword,
      page: params.page ?? 1,
      limit: params.pageSize ?? 50,
    });

    return (data.productOfferV2?.nodes ?? []).map((node) => this.mapNodeToOffer(node));
  }

  async getOffersByIds(params: GetOffersByIdsParams): Promise<RawMarketplaceOffer[]> {
    // A API publica nao documenta um "get by ids" direto para item — na pratica
    // o polling de itens conhecidos tende a reusar productOfferV2 filtrando por
    // itemId, ou shopOfferV2 quando a oferta e por loja. Ajustar conforme schema real.
    const query = `
      query ProductOfferV2ByIds($itemIdList: [Int!]) {
        productOfferV2(itemIdList: $itemIdList) {
          nodes {
            itemId
            shopId
            productName
            imageUrl
            price
            priceMin
            priceMax
            commissionRate
            commission
            sales
            ratingStar
            productLink
            offerLink
          }
        }
      }
    `;

    const data = await this.graphqlRequest<{
      productOfferV2: { nodes: Record<string, any>[] };
    }>(query, {
      itemIdList: params.externalIds.map((id) => Number(id)),
    });

    return (data.productOfferV2?.nodes ?? []).map((node) => this.mapNodeToOffer(node));
  }

  async generateAffiliateLink(offer: RawMarketplaceOffer): Promise<AffiliateLinkResult> {
    // Operacao generateShortLink.
    const query = `
      mutation GenerateShortLink($originUrl: String!, $subIds: [String!]) {
        generateShortLink(originUrl: $originUrl, subIds: $subIds) {
          shortLink
        }
      }
    `;

    const data = await this.graphqlRequest<{ generateShortLink: { shortLink: string } }>(query, {
      originUrl: offer.url,
      subIds: ['achadinhos'],
    });

    return {
      originalLink: offer.url,
      shortLink: data.generateShortLink?.shortLink,
      subId: 'achadinhos',
    };
  }

  private mapNodeToOffer(node: Record<string, any>): RawMarketplaceOffer {
    const priceCents = Math.round(Number(node.price ?? node.priceMin ?? 0) * 100);
    const commissionRateBp = Math.round(Number(node.commissionRate ?? 0) * 10000);
    const commissionCents = node.commission
      ? Math.round(Number(node.commission) * 100)
      : Math.round((priceCents * commissionRateBp) / 10000);

    return {
      marketplace: Marketplace.SHOPEE,
      externalId: String(node.itemId),
      externalShopId: node.shopId ? String(node.shopId) : undefined,
      title: node.productName,
      url: node.productLink ?? node.offerLink,
      imageUrl: node.imageUrl,
      priceCents,
      commissionRateBp,
      commissionCents,
      inStock: true, // API de oferta nao costuma retornar estoque; refinar via getItemFeedData se necessario.
      ratingStar: node.ratingStar ? Number(node.ratingStar) : undefined,
      salesCount: node.sales ? Number(node.sales) : undefined,
      raw: node,
    };
  }
}
