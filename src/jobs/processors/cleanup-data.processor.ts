import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DealStatus } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { QUEUE_CLEANUP_DATA } from '../jobs.constants';

/**
 * Job cleanup:data (secao 19). Expira deals antigos que ficaram parados em
 * DETECTED/PUBLISHED sem decisao humana, evitando que o operador veja
 * ofertas ja obsoletas como pendentes.
 */
const DEAL_EXPIRATION_HOURS = 48;

@Processor(QUEUE_CLEANUP_DATA, { concurrency: 1 })
export class CleanupDataProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupDataProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - DEAL_EXPIRATION_HOURS * 60 * 60 * 1000);

    const result = await this.prisma.deal.updateMany({
      where: {
        status: { in: [DealStatus.DETECTED, DealStatus.PUBLISHED] },
        detectedAt: { lt: cutoff },
      },
      data: { status: DealStatus.EXPIRED },
    });

    this.logger.log(`Cleanup concluido: ${result.count} deals expirados`);
    return { expired: result.count };
  }
}
