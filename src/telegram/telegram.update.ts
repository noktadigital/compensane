import { Logger } from '@nestjs/common';
import { Action, Command, Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { DecisionType } from '@prisma/client';
import { DealsService } from '@/deals/deals.service';
import { TrackingService } from '@/tracking/tracking.service';
import { PostTemplateService } from '@/posts/post-template.service';
import { MarketplaceAdapterRegistry } from '@/marketplaces/core/marketplace-adapter.registry';
import { AppConfigService } from '@/config/app-config.service';
import { PrismaService } from '@/database/prisma.service';
import { TrackingMetricsFormatter } from './tracking-metrics.formatter';

/**
 * Handlers de interacao do bot (secao 12): aprovar/rejeitar ofertas e
 * comandos administrativos basicos. A geracao de link de afiliado e do
 * post para WhatsApp acontece aqui, na aprovacao — coincide com o fluxo
 * "Ao clicar APROVAR" do briefing.
 */
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly dealsService: DealsService,
    private readonly trackingService: TrackingService,
    private readonly postTemplate: PostTemplateService,
    private readonly marketplaceRegistry: MarketplaceAdapterRegistry,
    private readonly metricsFormatter: TrackingMetricsFormatter,
    private readonly appConfig: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply(
      'Achadinhos bot ativo. Voce recebera ofertas aqui para aprovar ou rejeitar.\n\nComandos:\n/status — metricas basicas',
    );
  }

  @Action(/^deal:approve:(.+)$/)
  async onApprove(@Ctx() ctx: Context & { match: RegExpMatchArray }) {
    const dealId = ctx.match[1];
    await ctx.answerCbQuery('Aprovando...');

    const deal = await this.dealsService.getDealWithOffer(dealId);
    if (!deal) {
      await ctx.reply('Deal nao encontrado.');
      return;
    }

    const decidedBy = ctx.from ? `${ctx.from.id}:${ctx.from.username ?? ctx.from.first_name}` : undefined;
    await this.trackingService.recordDecision({ dealId, decision: DecisionType.APPROVE, decidedBy });
    await this.dealsService.markPublished(dealId);

    const adapter = this.marketplaceRegistry.get(deal.productOffer.marketplace);
    const affiliateLink = await adapter.generateAffiliateLink({
      marketplace: deal.productOffer.marketplace,
      externalId: deal.productOffer.externalId,
      title: deal.productOffer.product.title,
      url: deal.productOffer.url,
      priceCents: deal.priceCents,
      inStock: true,
    });

    const storedLink = await this.prisma.affiliateLink.create({
      data: {
        dealId: deal.id,
        productOfferId: deal.productOffer.id,
        originalLink: affiliateLink.originalLink,
        shortLink: affiliateLink.shortLink,
        subId: affiliateLink.subId,
      },
    });

    // Usa o redirecionador proprio /r/{slug} (secao 15) em vez do link direto:
    // registra clique e serve preview de Open Graph correto para anuncios pagos.
    const finalLink = `${this.appConfig.appUrl}/r/${storedLink.id}`;

    const whatsappText = this.postTemplate.buildWhatsappPost({
      title: deal.productOffer.product.title,
      priceCents: deal.priceCents,
      discountRate: deal.discountRate,
      freeShipping: deal.freeShipping,
      link: finalLink,
    });

    const whatsappUrl = this.postTemplate.buildWhatsappShareUrl(whatsappText);
    const whatsappWebUrl = this.postTemplate.buildWhatsappWebShareUrl(whatsappText);

    await ctx.reply(
      `✅ Aprovado!\n\n📋 Post pronto para WhatsApp:\n\n${whatsappText}\n\n🔗 Link direto: ${whatsappWebUrl}`,
    );

    this.logger.log(`Deal ${dealId} aprovado. Link: ${finalLink}`);
  }

  @Action(/^deal:reject:(.+)$/)
  async onReject(@Ctx() ctx: Context & { match: RegExpMatchArray }) {
    const dealId = ctx.match[1];
    await ctx.answerCbQuery('Rejeitando...');

    const decidedBy = ctx.from ? `${ctx.from.id}:${ctx.from.username ?? ctx.from.first_name}` : undefined;
    await this.trackingService.recordDecision({ dealId, decision: DecisionType.REJECT, decidedBy });

    await ctx.reply('❌ Oferta rejeitada.');
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context) {
    const metrics = await this.trackingService.getBasicMetrics();
    await ctx.reply(this.metricsFormatter.format(metrics));
  }
}
