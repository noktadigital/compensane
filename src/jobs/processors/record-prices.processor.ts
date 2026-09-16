import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';
import { PriceRecordingService } from '@/price-history/price-recording.service';
import { PrismaService } from '@/database/prisma.service';
import { DealsService } from '@/deals/deals.service';
import { ProductsService } from '@/products/products.service';
import { AppConfigService } from '@/config/app-config.service';
import { DiscordClientService } from '@/discord/discord-client.service';
import { QUEUE_RECORD_PRICES } from '../jobs.constants';
import { LOW_COST_WORKER_OPTIONS } from '../worker-options';

interface RecordPriceJobData {
  productOfferId: string;
  raw: RawMarketplaceOffer;
}

/**
 * Job record:prices (secao 19). Grava a observacao (se algo relevante mudou)
 * e, no MESMO processo, roda a analise e envia a notificacao quando a oferta
 * merece publicacao.
 *
 * POR QUE ANALISE E NOTIFICACAO NAO TEM FILA PROPRIA: cada fila registrada
 * custa ~744 comandos/hora no Redis so esperando trabalho, e o Upstash cobra
 * por requisicao. As filas analyze-deals e notify-discord existiam para
 * executar, respectivamente, um calculo local (ler historico no Postgres e
 * pontuar) e uma chamada HTTP ao Discord — nenhum dos dois precisa de retry
 * distribuido nem de persistencia propria. Mantê-las custava mais do que o
 * trabalho que faziam. Se a analise falhar, o proprio job de record-prices
 * e retentado pelo BullMQ.
 */
@Processor(QUEUE_RECORD_PRICES, { concurrency: 5, ...LOW_COST_WORKER_OPTIONS })
export class RecordPricesProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordPricesProcessor.name);

  constructor(
    private readonly priceRecording: PriceRecordingService,
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
    private readonly productsService: ProductsService,
    private readonly appConfig: AppConfigService,
    private readonly discordClient: DiscordClientService,
  ) {
    super();
  }

  async process(job: Job<RecordPriceJobData>): Promise<{ recorded: boolean; dealId?: string }> {
    const { productOfferId, raw } = job.data;
    const observation = await this.priceRecording.recordObservation(productOfferId, raw);

    // Preco nao mudou: nada novo para analisar.
    if (!observation) {
      return { recorded: false };
    }

    const result = await this.dealsService.analyzeOffer(productOfferId);

    if (result.discarded || !result.deal) {
      this.logger.debug(`Oferta ${productOfferId} descartada: ${result.reasons.join('; ')}`);
      return { recorded: true };
    }

    const deal = result.deal;

    // Queda relevante promove a oferta para o tier HOT (secao 20).
    if (deal.discountRate >= this.appConfig.dealRules.minRealDiscount * 1.5) {
      await this.productsService.promoteToHotTier(productOfferId);
    }

    if (deal.dealScore >= this.appConfig.dealRules.publishScore) {
      await this.notify(deal.id, productOfferId);
    }

    return { recorded: true, dealId: deal.id };
  }

  /** Envia o card de aprovacao. Falha aqui nao deve desfazer a analise. */
  private async notify(dealId: string, productOfferId: string): Promise<void> {
    try {
      const full = await this.dealsService.getDealWithOffer(dealId);
      if (!full) {
        return;
      }

      const latest = await this.prisma.priceObservation.findFirst({
        where: { productOfferId },
        orderBy: { observedAt: 'desc' },
        select: { discountRate: true },
      });

      await this.discordClient.sendDealCard(
        full.id,
        {
          title: full.productOffer.product.title,
          priceCents: full.priceCents,
          discountRate: full.discountRate,
          advertisedDiscountRate: latest?.discountRate,
          freeShipping: full.freeShipping,
          link: full.productOffer.url,
          ratingStar: full.productOffer.ratingStar,
          dealScore: full.dealScore,
          minPrice90dCents: full.minPrice90dCents,
          commissionCents: full.commissionCents,
        },
        full.productOffer.imageUrl,
      );
    } catch (error) {
      this.logger.error(`Falha ao notificar deal ${dealId}`, error as Error);
    }
  }
}
