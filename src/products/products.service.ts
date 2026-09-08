import { Injectable, Logger } from '@nestjs/common';
import { PollingTier, ProductOffer } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { DeduplicationService } from '@/dedup/deduplication.service';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';

/**
 * Normalizer + upsert de Product/ProductOffer (etapa "Normalizer" do
 * pipeline, secao 18). Recebe RawMarketplaceOffer (formato comum de
 * qualquer adapter) e garante Product + ProductOffer persistidos/atualizados.
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dedup: DeduplicationService,
  ) {}

  async upsertFromRawOffer(raw: RawMarketplaceOffer): Promise<ProductOffer> {
    const productKey = this.dedup.buildProductKey(raw);

    const product = await this.prisma.product.upsert({
      where: { normalizedKey: productKey },
      create: {
        title: raw.title,
        normalizedKey: productKey,
        gtin: raw.gtin,
        brand: raw.brand,
        category: raw.category,
        imageUrl: raw.imageUrl,
      },
      update: {
        // Mantem o titulo/imagem mais recentes vistos para o produto conceitual.
        title: raw.title,
        imageUrl: raw.imageUrl ?? undefined,
        category: raw.category ?? undefined,
      },
    });

    const offer = await this.prisma.productOffer.upsert({
      where: {
        marketplace_externalId: {
          marketplace: raw.marketplace,
          externalId: raw.externalId,
        },
      },
      create: {
        productId: product.id,
        marketplace: raw.marketplace,
        externalId: raw.externalId,
        externalShopId: raw.externalShopId,
        sellerName: raw.sellerName,
        url: raw.url,
        imageUrl: raw.imageUrl,
        ratingStar: raw.ratingStar,
        ratingCount: raw.ratingCount,
        salesCount: raw.salesCount,
        commissionRateBp: raw.commissionRateBp,
        pollingTier: PollingTier.WARM,
        lastCollectedAt: new Date(),
      },
      update: {
        sellerName: raw.sellerName ?? undefined,
        url: raw.url,
        imageUrl: raw.imageUrl ?? undefined,
        ratingStar: raw.ratingStar ?? undefined,
        ratingCount: raw.ratingCount ?? undefined,
        salesCount: raw.salesCount ?? undefined,
        commissionRateBp: raw.commissionRateBp ?? undefined,
        lastCollectedAt: new Date(),
      },
    });

    this.logger.debug(`Produto normalizado: ${offer.marketplace}/${offer.externalId}`);

    return offer;
  }

  async findActiveOffersByTier(tier: PollingTier, take?: number): Promise<ProductOffer[]> {
    return this.prisma.productOffer.findMany({
      where: { pollingTier: tier, active: true },
      orderBy: { lastCollectedAt: 'asc' },
      take,
    });
  }

  async promoteToHotTier(productOfferId: string): Promise<void> {
    await this.prisma.productOffer.update({
      where: { id: productOfferId },
      data: { pollingTier: PollingTier.HOT },
    });
  }
}
