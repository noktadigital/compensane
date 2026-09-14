import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Marketplace, PollingTier } from '@prisma/client';
import { ProductsService } from '@/products/products.service';
import { MERCADO_LIVRE_ADAPTER } from '@/marketplaces/mercado-livre/mercado-livre.module';
import { MarketplaceAdapter } from '@/marketplaces/core/marketplace-adapter.interface';
import {
  QUEUE_COLLECT_MERCADO_LIVRE,
  QUEUE_RECORD_PRICES,
  JOB_RECORD_PRICE,
} from '../jobs.constants';

interface CollectTierJobData {
  tier: PollingTier;
}

/**
 * Job collect:mercado-livre (secao 19), espelhando CollectShopeeProcessor.
 * Fila separada da Shopee para isolar rate limit por marketplace, conforme
 * exigido pelo briefing (secao 19: "cada marketplace deve ter seu proprio
 * rate limit").
 */
@Processor(QUEUE_COLLECT_MERCADO_LIVRE, { concurrency: 1 })
export class CollectMercadoLivreProcessor extends WorkerHost {
  private readonly logger = new Logger(CollectMercadoLivreProcessor.name);

  constructor(
    private readonly productsService: ProductsService,
    @Inject(MERCADO_LIVRE_ADAPTER) private readonly mercadoLivreAdapter: MarketplaceAdapter,
    @InjectQueue(QUEUE_RECORD_PRICES) private readonly recordPricesQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<CollectTierJobData>): Promise<{ collected: number }> {
    const { tier } = job.data;
    this.logger.log(`Iniciando coleta Mercado Livre para tier ${tier}`);

    const offers = await this.productsService.findActiveOffersByTier(
      Marketplace.MERCADO_LIVRE,
      tier,
    );

    if (offers.length === 0) {
      this.logger.debug(`Nenhuma oferta ativa no tier ${tier} ainda.`);
      return { collected: 0 };
    }

    const externalIds = offers.map((o) => o.externalId);
    const rawOffers = await this.mercadoLivreAdapter.getOffersByIds({ externalIds });

    let collected = 0;
    for (const raw of rawOffers) {
      const offer = await this.productsService.upsertFromRawOffer(raw);
      await this.recordPricesQueue.add(
        JOB_RECORD_PRICE,
        { productOfferId: offer.id, raw },
        { removeOnComplete: 200, removeOnFail: 500 },
      );
      collected++;
    }

    this.logger.log(`Coleta Mercado Livre (${tier}) concluida: ${collected} ofertas processadas`);
    return { collected };
  }
}
