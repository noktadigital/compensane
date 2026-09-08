import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PollingTier } from '@prisma/client';
import { AppConfigService } from '@/config/app-config.service';
import {
  QUEUE_COLLECT_SHOPEE,
  QUEUE_AGGREGATE_DAILY,
  QUEUE_CLEANUP_DATA,
  JOB_COLLECT_TIER,
  JOB_AGGREGATE_DAILY,
  JOB_CLEANUP,
} from './jobs.constants';
import { QUEUE_DISCOVER_SHOPEE, JOB_DISCOVER_KEYWORD } from './processors/discover-shopee.processor';

const MINUTE_MS = 60_000;

/**
 * Agenda os jobs recorrentes (secao 19/20) usando setInterval com os
 * intervalos configurados (nunca hardcoded — vem de AppConfigService/.env).
 * Os tiers HOT/WARM/COLD cada um roda no seu proprio intervalo, respeitando
 * o rate limit da Shopee (concurrency=1 no processor de coleta).
 */
@Injectable()
export class JobsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(JobsSchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly appConfig: AppConfigService,
    @InjectQueue(QUEUE_COLLECT_SHOPEE) private readonly collectQueue: Queue,
    @InjectQueue(QUEUE_DISCOVER_SHOPEE) private readonly discoverQueue: Queue,
    @InjectQueue(QUEUE_AGGREGATE_DAILY) private readonly aggregateQueue: Queue,
    @InjectQueue(QUEUE_CLEANUP_DATA) private readonly cleanupQueue: Queue,
  ) {}

  onModuleInit() {
    const tiers = this.appConfig.pollingTiers;

    this.scheduleInterval(tiers.hot.intervalMin, () => this.enqueueCollect(PollingTier.HOT));
    this.scheduleInterval(tiers.warm.intervalMin, () => this.enqueueCollect(PollingTier.WARM));
    this.scheduleInterval(tiers.cold.intervalMin, () => this.enqueueCollect(PollingTier.COLD));

    // Descoberta por keyword roda a cada 6 horas por padrao — nao precisa ser tao frequente quanto o polling.
    this.scheduleInterval(360, () => this.enqueueDiscover());

    // Agregacao diaria e cleanup rodam a cada hora — idempotentes, seguro repetir.
    this.scheduleInterval(60, () => this.enqueueAggregate());
    this.scheduleInterval(60, () => this.enqueueCleanup());

    this.logger.log(
      `Jobs agendados: collect HOT=${tiers.hot.intervalMin}min WARM=${tiers.warm.intervalMin}min COLD=${tiers.cold.intervalMin}min, discover=360min, aggregate/cleanup=60min`,
    );
  }

  private scheduleInterval(intervalMinutes: number, callback: () => void) {
    callback(); // dispara uma vez no boot para nao esperar o primeiro intervalo.
    const timer = setInterval(callback, intervalMinutes * MINUTE_MS);
    this.timers.push(timer);
  }

  private async enqueueCollect(tier: PollingTier) {
    await this.collectQueue.add(
      JOB_COLLECT_TIER,
      { tier },
      {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  private async enqueueDiscover() {
    await this.discoverQueue.add(
      JOB_DISCOVER_KEYWORD,
      {},
      {
        removeOnComplete: 20,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  private async enqueueAggregate() {
    await this.aggregateQueue.add(
      JOB_AGGREGATE_DAILY,
      {},
      { removeOnComplete: 10, removeOnFail: 20, attempts: 2 },
    );
  }

  private async enqueueCleanup() {
    await this.cleanupQueue.add(
      JOB_CLEANUP,
      {},
      { removeOnComplete: 10, removeOnFail: 20, attempts: 2 },
    );
  }
}
