import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PriceAggregationService } from '@/price-history/price-aggregation.service';
import { QUEUE_AGGREGATE_DAILY } from '../jobs.constants';

/**
 * Job aggregate:daily (secao 19). Roda periodicamente (scheduler) para
 * consolidar as observacoes do dia em DailyPriceAggregate, a base para
 * todos os calculos de historico/plateau/confianca.
 */
@Processor(QUEUE_AGGREGATE_DAILY, { concurrency: 1 })
export class AggregateDailyProcessor extends WorkerHost {
  private readonly logger = new Logger(AggregateDailyProcessor.name);

  constructor(private readonly aggregationService: PriceAggregationService) {
    super();
  }

  async process(_job: Job): Promise<{ aggregated: number }> {
    const count = await this.aggregationService.aggregateAllForToday();
    this.logger.log(`Agregacao diaria concluida: ${count} ofertas processadas`);
    return { aggregated: count };
  }
}
