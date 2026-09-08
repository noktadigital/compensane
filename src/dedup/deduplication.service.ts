import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';

/**
 * Estrategia de deduplicacao (secao 22):
 *   1. GTIN/EAN quando disponivel — mesmo produto fisico, mesmo Product.
 *   2. Fallback: titulo normalizado (sem acentuacao/pontuacao/case) + categoria.
 *
 * IMPORTANTE: nao fundimos ofertas de vendedores diferentes no historico de
 * preco. Dedupe aqui serve para agrupar sob o mesmo Product "conceitual";
 * cada ProductOffer (marketplace + externalId) mantem seu proprio historico.
 */
@Injectable()
export class DeduplicationService {
  /** Chave estavel para o Product conceitual, usada em Product.normalizedKey. */
  buildProductKey(offer: Pick<RawMarketplaceOffer, 'gtin' | 'title' | 'brand'>): string {
    if (offer.gtin) {
      return `gtin:${offer.gtin.trim()}`;
    }

    const normalizedTitle = this.normalizeTitle(offer.title);
    const brandPart = offer.brand ? this.normalizeTitle(offer.brand) : '';
    const base = `${brandPart}:${normalizedTitle}`;
    const hash = createHash('sha1').update(base).digest('hex').slice(0, 16);

    return `title:${hash}`;
  }

  /** Normaliza titulo removendo acentos, pontuacao e variacoes de espacamento/case. */
  normalizeTitle(title: string): string {
    return title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Chave unica da oferta especifica de um vendedor (nunca deve ser fundida entre vendedores). */
  buildOfferUniqueKey(marketplace: string, externalId: string): string {
    return `${marketplace}:${externalId}`;
  }
}
