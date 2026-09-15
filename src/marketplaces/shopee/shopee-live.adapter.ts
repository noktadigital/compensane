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
 * Campos do node ProductOfferV2 confirmados por introspeccao contra a API
 * real. Centralizados para que searchOffers e getOffersByIds nunca divirjam.
 *
 * priceDiscountRate e o desconto que a PROPRIA Shopee anuncia. Nao usamos
 * esse numero como verdade — ele e exatamente o tipo de dado que mascara
 * falso desconto. Guardamos em `raw` para poder confrontar o anunciado
 * contra o nosso historico de precos e flagrar a divergencia.
 */
const OFFER_NODE_FIELDS = `
  itemId
  shopId
  shopName
  productName
  imageUrl
  price
  priceMin
  priceMax
  priceDiscountRate
  commissionRate
  commission
  sales
  ratingStar
  productLink
  offerLink
`;

const PRODUCT_OFFER_BY_ID_QUERY = `
  query ProductOfferById($itemId: Int64) {
    productOfferV2(itemId: $itemId) {
      nodes { ${OFFER_NODE_FIELDS} }
    }
  }
`;

/**
 * Adapter para a Shopee Affiliate Open API (GraphQL).
 *
 * Schema validado por introspeccao contra a API real (conta de afiliado
 * aprovada). Particularidades que custaram descoberta e nao sao obvias:
 *
 *   - Nao existe `itemIdList`: productOfferV2 busca UM itemId por chamada.
 *   - `Int64` (itemId, shopId) precisa ir como STRING no JSON; como number
 *     a API responde {"code":10010,"message":"wrong type"}.
 *   - `generateShortLink` recebe um input object (ShortLinkInput), nao
 *     argumentos soltos.
 *   - Todos os precos e taxas voltam como STRING ("99.9", "0.53"), e
 *     commissionRate e fracao (0.53 = 53%), nao porcentagem.
 *
 * Queries disponiveis: productOfferV2, shopOfferV2, shopeeOfferV2,
 * conversionReport, validatedReport, partnerOrderReport, listItemFeeds,
 * getItemFeedData. Mutations: generateShortLink, generateBatchShortLink.
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
          nodes { ${OFFER_NODE_FIELDS} }
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
    // A API nao aceita lista de ids: productOfferV2 filtra por UM itemId por
    // chamada (nao existe itemIdList no schema). Entao o polling faz uma
    // chamada por item, sequencialmente, para nao disparar rate limit.
    //
    // itemId e Int64 e precisa ir como STRING no JSON — enviar como number
    // retorna {"code":10010,"message":"wrong type"} (verificado contra a API).
    const offers: RawMarketplaceOffer[] = [];

    for (const externalId of params.externalIds) {
      try {
        const data = await this.graphqlRequest<{
          productOfferV2: { nodes: Record<string, any>[] };
        }>(PRODUCT_OFFER_BY_ID_QUERY, { itemId: String(externalId) });

        const node = data.productOfferV2?.nodes?.[0];
        if (node) {
          offers.push(this.mapNodeToOffer(node));
        } else {
          // Item saiu do catalogo de ofertas de afiliado (ou acabou o estoque).
          this.logger.warn(`Shopee nao retornou oferta para itemId=${externalId}`);
        }
      } catch (err) {
        // Um item que falha nao pode derrubar o lote inteiro do polling.
        this.logger.error(
          `Falha ao buscar itemId=${externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return offers;
  }

  async generateAffiliateLink(offer: RawMarketplaceOffer): Promise<AffiliateLinkResult> {
    // A mutation recebe um input object (ShortLinkInput), nao argumentos
    // soltos: { originUrl: String!, subIds: [String!] } — confirmado por
    // introspeccao contra a API real.
    const mutation = `
      mutation GenerateShortLink($input: ShortLinkInput!) {
        generateShortLink(input: $input) {
          shortLink
        }
      }
    `;

    const subId = 'achadinhos';

    try {
      const data = await this.graphqlRequest<{ generateShortLink: { shortLink: string } }>(
        mutation,
        { input: { originUrl: offer.url, subIds: [subId] } },
      );

      return {
        originalLink: offer.url,
        shortLink: data.generateShortLink?.shortLink,
        subId,
      };
    } catch (err) {
      // productOfferV2 ja devolve um offerLink de afiliado pronto. Se a
      // geracao sob demanda falhar, caimos nele em vez de perder a oferta —
      // mas sem o subId, entao o clique nao fica atribuido a esta campanha.
      const fallback = (offer.raw as Record<string, any> | undefined)?.offerLink;
      this.logger.error(
        `generateShortLink falhou para ${offer.externalId}: ${
          err instanceof Error ? err.message : String(err)
        }${fallback ? ' — usando offerLink do catalogo (sem subId)' : ''}`,
      );

      if (!fallback) {
        throw err;
      }

      return { originalLink: offer.url, shortLink: fallback };
    }
  }

  private mapNodeToOffer(node: Record<string, any>): RawMarketplaceOffer {
    const priceCents = Math.round(Number(node.price ?? node.priceMin ?? 0) * 100);
    const commissionRateBp = Math.round(Number(node.commissionRate ?? 0) * 10000);
    const commissionCents = node.commission
      ? Math.round(Number(node.commission) * 100)
      : Math.round((priceCents * commissionRateBp) / 10000);

    // Desconto ANUNCIADO pela Shopee (0-100). Guardamos por auditoria, mas o
    // sistema nunca decide por ele: o desconto real sai do nosso proprio
    // historico de precos. Divergencia entre os dois e justamente o sinal de
    // falso desconto (preco inflado antes da "promocao").
    const advertisedDiscountRate =
      node.priceDiscountRate != null ? Number(node.priceDiscountRate) / 100 : undefined;

    // A Shopee NAO devolve o preco "de" como campo — so a taxa de desconto.
    // Derivamos para exibir no post o mesmo valor riscado que o cliente ve na
    // pagina do produto: um riscado que nao bate com o que a loja mostra
    // queima a credibilidade do canal.
    //
    // A taxa vem arredondada em inteiro, entao o derivado pode diferir em
    // centavos do exibido pela Shopee; arredondar para o real mais proximo
    // esconde essa diferenca na pratica.
    const originalPriceCents =
      advertisedDiscountRate && advertisedDiscountRate > 0 && advertisedDiscountRate < 1
        ? Math.round(priceCents / (1 - advertisedDiscountRate) / 100) * 100
        : undefined;

    return {
      marketplace: Marketplace.SHOPEE,
      externalId: String(node.itemId),
      externalShopId: node.shopId ? String(node.shopId) : undefined,
      sellerName: node.shopName || undefined,
      title: node.productName,
      url: node.productLink ?? node.offerLink,
      imageUrl: node.imageUrl,
      priceCents,
      originalPriceCents,
      discountRate: advertisedDiscountRate,
      commissionRateBp,
      commissionCents,
      inStock: true, // API de oferta nao costuma retornar estoque; refinar via getItemFeedData se necessario.
      ratingStar: node.ratingStar ? Number(node.ratingStar) : undefined,
      salesCount: node.sales ? Number(node.sales) : undefined,
      raw: node,
    };
  }
}
