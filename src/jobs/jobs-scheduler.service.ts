import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DealStatus, PollingTier } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import {
  QUEUE_COLLECT_SHOPEE,
  QUEUE_AGGREGATE_DAILY,
  JOB_COLLECT_TIER,
  JOB_AGGREGATE_DAILY,
} from './jobs.constants';
import { QUEUE_DISCOVER_SHOPEE, JOB_DISCOVER_KEYWORD } from './processors/discover-shopee.processor';

/** Horarios (hora local do servidor) em que a coleta de precos roda. */
const COLLECT_HOURS = [8, 12, 16, 20];
/** Horario da descoberta de produtos novos e da manutencao diaria. */
const DISCOVER_HOUR = 7;
/** Deals sem decisao humana expiram depois disto. */
const DEAL_EXPIRATION_HOURS = 48;

const MINUTE_MS = 60_000;

/**
 * Agenda o trabalho recorrente em HORARIOS FIXOS (8h, 12h, 16h, 20h) em vez
 * de intervalos corridos.
 *
 * Por que horario fixo: intervalo corrido (a cada 15min) fazia ~96 ciclos de
 * coleta por dia para um catalogo cujo preco muda poucas vezes ao dia —
 * gastando rate limit da Shopee e requisicoes do Redis sem produzir dado
 * novo. Quatro coletas diarias cobrem a variacao real de preco e deixam o
 * historico crescer de forma previsivel.
 *
 * O relogio e conferido a cada minuto; o trabalho so dispara quando a hora
 * cheia bate e ainda nao rodou naquele horario.
 */
@Injectable()
export class JobsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsSchedulerService.name);
  private timer?: NodeJS.Timeout;
  /** Ultima execucao por marcador "YYYY-MM-DD:HH", para nao repetir na mesma hora. */
  private readonly lastRun = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_COLLECT_SHOPEE) private readonly collectQueue: Queue,
    @InjectQueue(QUEUE_DISCOVER_SHOPEE) private readonly discoverQueue: Queue,
    @InjectQueue(QUEUE_AGGREGATE_DAILY) private readonly aggregateQueue: Queue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.error('Falha no scheduler', error as Error));
    }, MINUTE_MS);

    this.logger.log(
      `Scheduler ativo: coleta as ${COLLECT_HOURS.map((h) => `${h}h`).join(', ')}; ` +
        `descoberta e manutencao as ${DISCOVER_HOUR}h.`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();
    const slot = `${now.toISOString().slice(0, 10)}:${hour}`;

    if (COLLECT_HOURS.includes(hour) && this.claimSlot('collect', slot)) {
      await this.enqueueCollect(PollingTier.HOT);
      await this.enqueueCollect(PollingTier.WARM);
      await this.aggregateQueue.add(
        JOB_AGGREGATE_DAILY,
        {},
        { removeOnComplete: 5, removeOnFail: 10, attempts: 2 },
      );
      this.logger.log(`Coleta das ${hour}h enfileirada.`);
    }

    if (hour === DISCOVER_HOUR && this.claimSlot('discover', slot)) {
      await this.discoverQueue.add(
        JOB_DISCOVER_KEYWORD,
        {},
        { removeOnComplete: 5, removeOnFail: 10, attempts: 2 },
      );
      // Manutencao diaria: query unica, nao precisa de fila propria.
      await this.expireStaleDeals();
      this.logger.log('Descoberta e manutencao diaria executadas.');
    }
  }

  /** Garante que cada horario dispare uma unica vez por dia. */
  private claimSlot(kind: string, slot: string): boolean {
    if (this.lastRun.get(kind) === slot) {
      return false;
    }
    this.lastRun.set(kind, slot);
    return true;
  }

  private async enqueueCollect(tier: PollingTier): Promise<void> {
    await this.collectQueue.add(
      JOB_COLLECT_TIER,
      { tier },
      {
        removeOnComplete: 10,
        removeOnFail: 20,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  /**
   * Expira deals que ficaram sem decisao humana. So DETECTED expira: um deal
   * PUBLISHED ja foi aprovado por uma pessoa, entao nao ha o que expirar —
   * marcar aprovado como expirado apagava o registro do que foi publicado.
   */
  private async expireStaleDeals(): Promise<void> {
    const cutoff = new Date(Date.now() - DEAL_EXPIRATION_HOURS * 60 * 60 * 1000);

    const result = await this.prisma.deal.updateMany({
      where: { status: DealStatus.DETECTED, detectedAt: { lt: cutoff } },
      data: { status: DealStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`${result.count} deals sem decisao expirados.`);
    }
  }
}
