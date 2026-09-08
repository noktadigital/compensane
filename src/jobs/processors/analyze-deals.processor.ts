import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DealsService } from '@/deals/deals.service';
import { AppConfigService } from '@/config/app-config.service';
import { ProductsService } from '@/products/products.service';
import { QUEUE_ANALYZE_DEALS, QUEUE_NOTIFY_TELEGRAM, JOB_NOTIFY_DEAL } from '../jobs.constants';

interface AnalyzeDealJobData {
  productOfferId: string;
}

/**
 * Job analyze:deals (secao 19). Roda o Analysis Engine para a oferta e,
 * se o deal detectado atingir o score de publicacao, enfileira a
 * notificacao no Telegram. Tambem promove a oferta para o tier HOT
 * quando uma queda relevante e detectada (secao 20).
 */
@Processor(QUEUE_ANALYZE_DEALS, { concurrency: 5 })
export class AnalyzeDealsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyzeDealsProcessor.name);

  constructor(
    private readonly dealsService: DealsService,
    private readonly appConfig: AppConfigService,
    private readonly productsService: ProductsService,
    @InjectQueue(QUEUE_NOTIFY_TELEGRAM) private readonly notifyQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<AnalyzeDealJobData>): Promise<{ dealId: string | null }> {
    const { productOfferId } = job.data;
    const result = await this.dealsService.analyzeOffer(productOfferId);

    if (result.discarded || !result.deal) {
      this.logger.debug(`Oferta ${productOfferId} descartada: ${result.reasons.join('; ')}`);
      return { dealId: null };
    }

    const { deal } = result;

    if (deal.dealScore >= this.appConfig.dealRules.publishScore) {
      await this.notifyQueue.add(
        JOB_NOTIFY_DEAL,
        { dealId: deal.id },
        { removeOnComplete: 200, removeOnFail: 500 },
      );
    }

    if (deal.discountRate >= this.appConfig.dealRules.minRealDiscount * 1.5) {
      await this.productsService.promoteToHotTier(productOfferId);
    }

    return { dealId: deal.id };
  }
}
