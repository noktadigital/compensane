import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DealsService } from '@/deals/deals.service';
import { PrismaService } from '@/database/prisma.service';
import { DiscordClientService } from '@/discord/discord-client.service';
import { QUEUE_NOTIFY_DISCORD } from '../jobs.constants';

interface NotifyDealJobData {
  dealId: string;
}

/**
 * Job notify:discord (secao 19). Envia o card da oferta detectada para o
 * canal do Discord (secao 12), com botoes de aprovar/rejeitar/ver produto.
 */
@Processor(QUEUE_NOTIFY_DISCORD, { concurrency: 3 })
export class NotifyDiscordProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyDiscordProcessor.name);

  constructor(
    private readonly dealsService: DealsService,
    private readonly prisma: PrismaService,
    private readonly discordClient: DiscordClientService,
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

    await this.discordClient.sendDealCard(
      deal.id,
      {
        title: deal.productOffer.product.title,
        priceCents: deal.priceCents,
        // Desconto REAL, apurado contra o nosso proprio historico de precos.
        discountRate: deal.discountRate,
        // Desconto ANUNCIADO pela loja, como veio na coleta. Os dois juntos
        // no card permitem flagrar preco inflado antes da "promocao".
        advertisedDiscountRate: await this.findAdvertisedDiscountRate(deal.productOfferId),
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

  /**
   * O desconto anunciado nao fica no ProductOffer (que guarda so o que e
   * estavel no tempo) e sim na observacao de preco mais recente, que e onde
   * registramos o estado da oferta a cada coleta.
   */
  private async findAdvertisedDiscountRate(productOfferId: string): Promise<number | null> {
    const latest = await this.prisma.priceObservation.findFirst({
      where: { productOfferId },
      orderBy: { observedAt: 'desc' },
      select: { discountRate: true },
    });

    return latest?.discountRate ?? null;
  }
}
