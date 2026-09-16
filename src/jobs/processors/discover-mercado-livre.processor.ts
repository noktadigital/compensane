import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@/database/prisma.service';
import { ProductsService } from '@/products/products.service';
import { MERCADO_LIVRE_ADAPTER } from '@/marketplaces/mercado-livre/mercado-livre.module';
import { MarketplaceAdapter } from '@/marketplaces/core/marketplace-adapter.interface';
import { LOW_COST_WORKER_OPTIONS } from '../worker-options';

export const QUEUE_DISCOVER_MERCADO_LIVRE = 'discover-mercado-livre';
export const JOB_DISCOVER_KEYWORD = 'discover-keyword';

/**
 * Job de descoberta por keyword para o Mercado Livre (secao 21), espelhando
 * DiscoverShopeeProcessor. NOTA: o endpoint de busca do ML tem restricoes
 * conhecidas (ver comentario em MercadoLivreLiveAdapter) — pode falhar com
 * 403 dependendo do nivel de acesso da conta.
 */
@Processor(QUEUE_DISCOVER_MERCADO_LIVRE, { concurrency: 1, ...LOW_COST_WORKER_OPTIONS })
export class DiscoverMercadoLivreProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoverMercadoLivreProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    @Inject(MERCADO_LIVRE_ADAPTER) private readonly mercadoLivreAdapter: MarketplaceAdapter,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ discovered: number }> {
    const keywords = await this.prisma.searchKeyword.findMany({
      where: { marketplace: 'MERCADO_LIVRE', enabled: true },
      orderBy: { priority: 'desc' },
    });

    if (keywords.length === 0) {
      this.logger.debug('Nenhuma SearchKeyword habilitada para Mercado Livre.');
      return { discovered: 0 };
    }

    let discovered = 0;
    for (const kw of keywords) {
      try {
        const results = await this.mercadoLivreAdapter.searchOffers({ keyword: kw.keyword });
        for (const raw of results) {
          await this.productsService.upsertFromRawOffer(raw);
          discovered++;
        }
      } catch (error) {
        this.logger.warn(
          `Falha ao buscar keyword "${kw.keyword}" no Mercado Livre: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Descoberta Mercado Livre concluida: ${discovered} ofertas processadas`);
    return { discovered };
  }
}
