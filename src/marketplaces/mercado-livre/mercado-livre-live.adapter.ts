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
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

interface MlItemSearchResult {
  results: MlItem[];
}

interface MlItem {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  currency_id: string;
  available_quantity: number;
  condition: string;
  permalink: string;
  thumbnail: string;
  seller?: { id: number; nickname?: string };
  seller_id?: number;
  shipping?: { free_shipping?: boolean };
  category_id?: string;
}

/**
 * Adapter para a API do Mercado Livre (REST, autenticada via OAuth2 + PKCE
 * — ver MercadoLivreOAuthService).
 *
 * LIMITACOES CONHECIDAS (confirmadas via documentacao publica e relatos de
 * outros desenvolvedores em setembro/2026):
 *
 *   1. O endpoint de busca publica `/sites/{site}/search` tem retornado
 *      403 Forbidden mesmo para aplicacoes com OAuth valido, sem
 *      comunicacao oficial clara do motivo — pode exigir participacao em
 *      um programa de parceiros especifico. Se `searchOffers` falhar
 *      consistentemente com 403, a descoberta por keyword (secao 21) nao
 *      vai funcionar até isso ser esclarecido/liberado pelo ML, mas
 *      `getOffersByIds` (buscar item especifico por ID) tende a funcionar
 *      normalmente pois usa outro endpoint (`/items/{id}`).
 *
 *   2. NAO existe API oficial para gerar link de afiliado (diferente da
 *      Shopee). O link e a URL do produto com os parametros `matt_word` e
 *      `matt_tool` (fixos por conta de afiliado, obtidos manualmente no
 *      Portal de Afiliados) anexados. Configurar via
 *      MERCADO_LIVRE_MATT_WORD / MERCADO_LIVRE_MATT_TOOL no .env.
 */
@Injectable()
export class MercadoLivreLiveAdapter implements MarketplaceAdapter {
  readonly marketplace = Marketplace.MERCADO_LIVRE;
  private readonly logger = new Logger(MercadoLivreLiveAdapter.name);
  private readonly SITE_ID = 'MLB'; // Brasil

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly oauthService: MercadoLivreOAuthService,
  ) {}

  private async authorizedFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const accessToken = await this.oauthService.getValidAccessToken();
    const { apiBaseUrl } = this.appConfig.mercadoLivre;

    const url = new URL(`${apiBaseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Mercado Livre API respondeu ${response.status} em ${path}: ${text}`);
      throw new HttpException(`Mercado Livre API error: ${response.status}`, response.status);
    }

    return response.json() as Promise<T>;
  }

  async searchOffers(params: SearchOffersParams): Promise<RawMarketplaceOffer[]> {
    // Ver limitacao (1) no comentario da classe — este endpoint pode
    // retornar 403 dependendo do nivel de acesso da conta de afiliado.
    const data = await this.authorizedFetch<MlItemSearchResult>(`/sites/${this.SITE_ID}/search`, {
      q: params.keyword,
      limit: String(params.pageSize ?? 50),
      offset: String(((params.page ?? 1) - 1) * (params.pageSize ?? 50)),
    });

    return (data.results ?? []).map((item) => this.mapItemToOffer(item));
  }

  async getOffersByIds(params: GetOffersByIdsParams): Promise<RawMarketplaceOffer[]> {
    // A API do ML permite buscar multiplos itens de uma vez via
    // /items?ids=ID1,ID2,... (ate 20 por chamada).
    const chunks: string[][] = [];
    for (let i = 0; i < params.externalIds.length; i += 20) {
      chunks.push(params.externalIds.slice(i, i + 20));
    }

    const offers: RawMarketplaceOffer[] = [];
    for (const chunk of chunks) {
      const data = await this.authorizedFetch<{ code: number; body: MlItem }[]>('/items', {
        ids: chunk.join(','),
      });

      for (const entry of data) {
        if (entry.code === 200 && entry.body) {
          offers.push(this.mapItemToOffer(entry.body));
        } else {
          this.logger.warn(`Item nao retornado com sucesso (code=${entry.code})`);
        }
      }
    }

    return offers;
  }

  async generateAffiliateLink(offer: RawMarketplaceOffer): Promise<AffiliateLinkResult> {
    // Ver limitacao (2) no comentario da classe — nao ha API de geracao de
    // link, montamos a URL manualmente com os parametros de afiliado fixos.
    const { mattWord, mattTool } = this.appConfig.mercadoLivre;

    if (!mattWord || !mattTool) {
      this.logger.warn(
        'MERCADO_LIVRE_MATT_WORD/MERCADO_LIVRE_MATT_TOOL nao configurados — retornando link sem tracking de afiliado.',
      );
      return { originalLink: offer.url };
    }

    const url = new URL(offer.url);
    url.searchParams.set('matt_word', mattWord);
    url.searchParams.set('matt_tool', mattTool);

    return {
      originalLink: offer.url,
      shortLink: url.toString(),
      subId: mattWord,
    };
  }

  private mapItemToOffer(item: MlItem): RawMarketplaceOffer {
    const priceCents = Math.round(item.price * 100);
    const originalPriceCents = item.original_price ? Math.round(item.original_price * 100) : undefined;

    return {
      marketplace: Marketplace.MERCADO_LIVRE,
      externalId: item.id,
      externalShopId: item.seller?.id ? String(item.seller.id) : item.seller_id ? String(item.seller_id) : undefined,
      sellerName: item.seller?.nickname,
      title: item.title,
      url: item.permalink,
      imageUrl: item.thumbnail,
      priceCents,
      originalPriceCents,
      freeShipping: item.shipping?.free_shipping ?? false,
      inStock: item.available_quantity > 0,
      category: item.category_id,
      raw: item,
    };
  }
}
