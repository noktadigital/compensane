import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Marketplace } from '@prisma/client';
import { AppConfigService } from '@/config/app-config.service';
import {
  AffiliateLinkResult,
  BrowseCategoryParams,
  GetOffersByIdsParams,
  MarketplaceAdapter,
  MarketplaceCategory,
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
/**
 * sortType=1 = ordenar por vendas. Confirmado por medicao contra a API:
 * sortType 1 e 2 trazem os mais vendidos, 3/4/5 trazem itens sem venda.
 */
const SORT_BY_SALES = 1;

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

  /**
   * Espacamento minimo entre chamadas e retry para o rate limit da Shopee.
   *
   * A API responde `error [10030]: Rate limit exceeded` quando recebe
   * chamadas em rajada — e como cada item do polling e uma chamada separada
   * (nao existe busca por lista de ids), o limite e atingido rapido. Sem
   * isso, uma rajada derruba o job inteiro e a coleta simplesmente para.
   */
  private static readonly MIN_INTERVAL_MS = 250;
  private static readonly RATE_LIMIT_RETRIES = 3;
  private static readonly RATE_LIMIT_BACKOFF_MS = 2000;
  private lastRequestAt = 0;

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < ShopeeLiveAdapter.MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, ShopeeLiveAdapter.MIN_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>,
    attempt = 1,
  ): Promise<T> {
    const { appId, appSecret, apiBaseUrl } = this.appConfig.shopee;

    if (!appId || !appSecret) {
      throw new Error(
        'SHOPEE_APP_ID/SHOPEE_APP_SECRET nao configurados. Defina SHOPEE_MODE=mock para desenvolvimento local.',
      );
    }

    await this.throttle();

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

    const json = (await response.json()) as {
      data?: T;
      errors?: { extensions?: { code?: number } }[];
    };

    if (json.errors && json.errors.length > 0) {
      const isRateLimit = json.errors.some((e) => e?.extensions?.code === 10030);

      // Rate limit e transitorio: espera e tenta de novo em vez de derrubar o
      // job. Sem isso, uma rajada some com a coleta inteira do ciclo.
      if (isRateLimit && attempt <= ShopeeLiveAdapter.RATE_LIMIT_RETRIES) {
        const delay = ShopeeLiveAdapter.RATE_LIMIT_BACKOFF_MS * attempt;
        this.logger.warn(
          `Rate limit da Shopee (tentativa ${attempt}/${ShopeeLiveAdapter.RATE_LIMIT_RETRIES}). Aguardando ${delay}ms.`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.graphqlRequest<T>(query, variables, attempt + 1);
      }

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

  /**
   * Categorias de oferta (shopeeOfferV2). Esta query devolve a CATEGORIA em
   * si — nome, link e comissao-teto — nao os produtos dela. O campo util
   * aqui e o categoryId, que alimenta browseCategory().
   */
  /**
   * Categorias sem volume de vendas no catalogo de afiliados. Medido: a
   * mediana de vendas da melhor pagina e 103 (Automobiles), 24
   * (Motorcycles) e 8 (Tickets) — contra milhares nas demais. Era dessas
   * que vinham "Capacete de Motocross" e "Farol LED Motocicleta".
   */
  private static readonly CATEGORIAS_SEM_VOLUME = new Set([
    'Automobiles',
    'Motorcycles',
    'Tickets, Vouchers & Services',
    'Food Delivery',
  ]);

  async listCategories(): Promise<MarketplaceCategory[]> {
    const query = `
      query ShopeeOfferV2($limit: Int) {
        shopeeOfferV2(limit: $limit) {
          nodes { offerName categoryId }
        }
      }
    `;

    // A Shopee recusa limit > 50 com error [11001]. As categorias cabem
    // folgadamente nesse teto (sao ~30).
    const data = await this.graphqlRequest<{
      shopeeOfferV2: { nodes: { offerName: string; categoryId: number | null }[] };
    }>(query, { limit: 50 });

    return (data.shopeeOfferV2?.nodes ?? [])
      .filter((n) => n.categoryId != null)
      .map((n) => ({
        id: String(n.categoryId),
        // Os nomes vem prefixados com hifens ("- - Health").
        name: n.offerName.replace(/^[-\s]+/, '').trim(),
      }))
      .filter((c) => !ShopeeLiveAdapter.CATEGORIAS_SEM_VOLUME.has(c.name));
  }

  /**
   * Produtos de uma categoria. Cobre o catalogo sem depender de adivinhar
   * palavra-chave — a busca textual casa qualquer titulo que CITE o termo,
   * o que fazia "whey protein" retornar shampoo capilar.
   *
   * sortType=1 e o que separa catalogo util de entulho. Sem ele a API
   * devolve o fundo do catalogo: medido em Men Clothes, a MEDIANA de vendas
   * da pagina era 0 e a media 46. Com sortType=1 a mesma chamada traz
   * mediana 4047 e topo acima de 20 mil vendas.
   *
   * Isso e a diferenca entre receber "Dedeira Moeda Antiga, 23 vendas" e
   * receber produto que a audiencia de fato compra.
   */
  async browseCategory(params: BrowseCategoryParams): Promise<RawMarketplaceOffer[]> {
    const query = `
      query ProductOfferByCategory($cat: Int, $page: Int, $limit: Int, $sort: Int) {
        productOfferV2(productCatId: $cat, page: $page, limit: $limit, sortType: $sort) {
          nodes { ${OFFER_NODE_FIELDS} }
        }
      }
    `;

    const data = await this.graphqlRequest<{
      productOfferV2: { nodes: Record<string, any>[] };
    }>(query, {
      cat: Number(params.categoryId),
      page: params.page ?? 1,
      limit: params.pageSize ?? 50,
      sort: params.sortType ?? SORT_BY_SALES,
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
