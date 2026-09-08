import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DealsService } from '@/deals/deals.service';
import { TelegramService } from '@/telegram/telegram.service';
import { QUEUE_NOTIFY_TELEGRAM } from '../jobs.constants';

interface NotifyDealJobData {
  dealId: string;
}

/**
 * Job notify:telegram (secao 19). Envia o card da oferta detectada para o
 * bot do Telegram (secao 12), com botoes de aprovar/rejeitar/ver produto.
 */
@Processor(QUEUE_NOTIFY_TELEGRAM, { concurrency: 3 })
export class NotifyTelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyTelegramProcessor.name);

  constructor(
    private readonly dealsService: DealsService,
    private readonly telegramService: TelegramService,
  ) {
    super();
  }

  async process(job: Job<NotifyDealJobData>): Promise<void> {
    const { dealId } = job.data;
    const deal = await this.dealsService.getDealWithOffer(dealId);

    if (!deal) {
      this.logger.warn(`Deal ${dealId} nao encontrado para notificacao.`);
      return;
    }

    await this.telegramService.sendDealCard(
      deal.id,
      {
        title: deal.productOffer.product.title,
        priceCents: deal.priceCents,
        discountRate: deal.discountRate,
        freeShipping: deal.freeShipping,
        link: deal.productOffer.url,
        ratingStar: deal.productOffer.ratingStar,
        dealScore: deal.dealScore,
        minPrice90dCents: deal.minPrice90dCents,
        commissionCents: deal.commissionCents,
      },
      deal.productOffer.imageUrl,
    );
  }
}
