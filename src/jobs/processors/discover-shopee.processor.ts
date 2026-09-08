import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@/database/prisma.service';
import { ProductsService } from '@/products/products.service';
import { SHOPEE_ADAPTER } from '@/marketplaces/shopee/shopee.module';
import { MarketplaceAdapter } from '@/marketplaces/core/marketplace-adapter.interface';

export const QUEUE_DISCOVER_SHOPEE = 'discover-shopee';
export const JOB_DISCOVER_KEYWORD = 'discover-keyword';

/**
 * Job de descoberta por keyword (secao 21). Consulta SearchKeyword ativas
 * e usa o adapter para buscar novas ofertas, criando Product/ProductOffer
 * (tier WARM por padrao) para itens ainda desconhecidos.
 */
@Processor(QUEUE_DISCOVER_SHOPEE, { concurrency: 1 })
export class DiscoverShopeeProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoverShopeeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    @Inject(SHOPEE_ADAPTER) private readonly shopeeAdapter: MarketplaceAdapter,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ discovered: number }> {
    const keywords = await this.prisma.searchKeyword.findMany({
      where: { marketplace: 'SHOPEE', enabled: true },
      orderBy: { priority: 'desc' },
    });

    if (keywords.length === 0) {
      this.logger.debug('Nenhuma SearchKeyword habilitada para Shopee.');
      return { discovered: 0 };
    }

    let discovered = 0;
    for (const kw of keywords) {
      const results = await this.shopeeAdapter.searchOffers({ keyword: kw.keyword });
      for (const raw of results) {
        await this.productsService.upsertFromRawOffer(raw);
        discovered++;
      }
    }

    this.logger.log(`Descoberta Shopee concluida: ${discovered} ofertas processadas`);
    return { discovered };
  }
}
