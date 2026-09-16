import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Marketplace, PollingTier } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ProductsService } from '@/products/products.service';
import { AppConfigService } from '@/config/app-config.service';
import { SHOPEE_ADAPTER } from '@/marketplaces/shopee/shopee.module';
import { MarketplaceAdapter } from '@/marketplaces/core/marketplace-adapter.interface';
import { QUEUE_COLLECT_SHOPEE, QUEUE_RECORD_PRICES, JOB_RECORD_PRICE } from '../jobs.constants';
import { LOW_COST_WORKER_OPTIONS } from '../worker-options';

interface CollectTierJobData {
  tier: PollingTier;
}

/**
 * Teto de ofertas por execucao de coleta. Com ~0,4s por item (a Shopee exige
 * uma chamada por item) e o tier WARM rodando a cada 2h, 120 itens levam ~50s
 * — bem dentro da janela, sem empilhar jobs nem estourar o rate limit.
 */
const MAX_OFFERS_PER_CYCLE = 120;

/**
 * Job collect:shopee (secao 19). Coleta ofertas de um tier de polling
 * (secao 20): busca produtos ja conhecidos daquele tier via adapter e
 * enfileira o registro de preco para cada oferta retornada. Tambem roda a
 * descoberta por keyword quando o tier e HOT (produtos quentes merecem
 * descoberta mais frequente de variantes/concorrentes).
 *
 * Retry/backoff, timeout e idempotencia sao responsabilidade do BullMQ
 * (configurado no JobsModule) — este processor so precisa ser
 * naturalmente idempotente, o que e verdade aqui pois so enfileira
 * registro de preco (que por sua vez so grava se algo mudou).
 */
@Processor(QUEUE_COLLECT_SHOPEE, {
  concurrency: 1, // Nunca bombardear a API da Shopee (secao 19) — uma coleta por vez.
  ...LOW_COST_WORKER_OPTIONS,
})
export class CollectShopeeProcessor extends WorkerHost {
  private readonly logger = new Logger(CollectShopeeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly appConfig: AppConfigService,
    @Inject(SHOPEE_ADAPTER) private readonly shopeeAdapter: MarketplaceAdapter,
    @InjectQueue(QUEUE_RECORD_PRICES) private readonly recordPricesQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<CollectTierJobData>): Promise<{ collected: number }> {
    const { tier } = job.data;
    this.logger.log(`Iniciando coleta Shopee para tier ${tier}`);

    // Limite por ciclo: cada item e uma chamada HTTP separada (~0,4s), entao
    // varrer centenas de ofertas de uma vez faz o job durar mais que o proprio
    // intervalo do tier e empilhar execucoes. findActiveOffersByTier ordena
    // por lastCollectedAt ascendente, entao as ofertas menos recentes vem
    // primeiro e o rodizio cobre todo o catalogo ao longo dos ciclos.
    const batchSize = this.appConfig.pollingTiers[tier === PollingTier.HOT ? 'hot' : 'warm'].size;
    const offers = await this.productsService.findActiveOffersByTier(
      Marketplace.SHOPEE,
      tier,
      Math.min(batchSize, MAX_OFFERS_PER_CYCLE),
    );

    if (offers.length === 0) {
      this.logger.debug(`Nenhuma oferta ativa no tier ${tier} ainda.`);
      return { collected: 0 };
    }

    const externalIds = offers.map((o) => o.externalId);
    const rawOffers = await this.shopeeAdapter.getOffersByIds({ externalIds });

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

    this.logger.log(`Coleta Shopee (${tier}) concluida: ${collected} ofertas processadas`);
    return { collected };
  }
}
