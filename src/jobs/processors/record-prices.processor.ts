import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';
import { PriceRecordingService } from '@/price-history/price-recording.service';
import { QUEUE_ANALYZE_DEALS, QUEUE_RECORD_PRICES, JOB_ANALYZE_DEAL } from '../jobs.constants';

interface RecordPriceJobData {
  productOfferId: string;
  raw: RawMarketplaceOffer;
}

/**
 * Job record:prices (secao 19). Grava a observacao (se algo relevante
 * mudou) e, quando ha mudanca real, dispara analyze:deals para essa
 * oferta — assim so gastamos ciclos de analise quando o preco de fato
 * mudou, e nao a cada poll.
 */
@Processor(QUEUE_RECORD_PRICES, { concurrency: 5 })
export class RecordPricesProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordPricesProcessor.name);

  constructor(
    private readonly priceRecording: PriceRecordingService,
    @InjectQueue(QUEUE_ANALYZE_DEALS) private readonly analyzeQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<RecordPriceJobData>): Promise<{ recorded: boolean }> {
    const { productOfferId, raw } = job.data;
    const observation = await this.priceRecording.recordObservation(productOfferId, raw);

    if (observation) {
      await this.analyzeQueue.add(
        JOB_ANALYZE_DEAL,
        { productOfferId },
        { removeOnComplete: 200, removeOnFail: 500 },
      );
      return { recorded: true };
    }

    return { recorded: false };
  }
}
