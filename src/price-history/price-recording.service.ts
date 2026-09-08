import { Injectable, Logger } from '@nestjs/common';
import { PriceObservation } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';

/**
 * Grava observacoes de preco (secao 5). So cria uma nova linha quando algo
 * relevante mudou desde a ultima observacao (preco, frete, comissao ou
 * estoque) — evita duplicacao desnecessaria em polls frequentes.
 */
@Injectable()
export class PriceRecordingService {
  private readonly logger = new Logger(PriceRecordingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordObservation(
    productOfferId: string,
    raw: RawMarketplaceOffer,
  ): Promise<PriceObservation | null> {
    const last = await this.prisma.priceObservation.findFirst({
      where: { productOfferId },
      orderBy: { observedAt: 'desc' },
    });

    const shippingCents = raw.freeShipping ? 0 : (raw.shippingCents ?? null);

    const hasRelevantChange =
      !last ||
      last.priceCents !== raw.priceCents ||
      (last.shippingCents ?? null) !== shippingCents ||
      (last.commissionCents ?? null) !== (raw.commissionCents ?? null) ||
      last.inStock !== raw.inStock;

    if (!hasRelevantChange) {
      return null;
    }

    const discountRate =
      raw.originalPriceCents && raw.originalPriceCents > raw.priceCents
        ? Number(((raw.originalPriceCents - raw.priceCents) / raw.originalPriceCents).toFixed(4))
        : null;

    const observation = await this.prisma.priceObservation.create({
      data: {
        productOfferId,
        source: raw.marketplace,
        priceCents: raw.priceCents,
        shippingCents,
        commissionCents: raw.commissionCents ?? null,
        inStock: raw.inStock,
        originalPriceCents: raw.originalPriceCents ?? null,
        discountRate,
        rawData: raw.raw ? JSON.parse(JSON.stringify(raw.raw)) : undefined,
      },
    });

    this.logger.log(
      `Preco mudou para ${productOfferId}: ${(raw.priceCents / 100).toFixed(2)} (estoque=${raw.inStock})`,
    );

    return observation;
  }
}
