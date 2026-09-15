import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ButtonInteraction, Interaction, MessageFlags } from 'discord.js';
import { DecisionType } from '@prisma/client';
import { DealsService } from '@/deals/deals.service';
import { TrackingService } from '@/tracking/tracking.service';
import { PostTemplateService } from '@/posts/post-template.service';
import { MarketplaceAdapterRegistry } from '@/marketplaces/core/marketplace-adapter.registry';
import { AppConfigService } from '@/config/app-config.service';
import { PrismaService } from '@/database/prisma.service';
import { DiscordClientService } from './discord-client.service';

/**
 * Handlers de interacao (secao 12): aprovar/rejeitar ofertas. A geracao do
 * link de afiliado e do post para WhatsApp acontece aqui, na aprovacao —
 * coincide com o fluxo "Ao clicar APROVAR" do briefing.
 */
@Injectable()
export class DiscordInteractionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscordInteractionService.name);

  constructor(
    private readonly discordClient: DiscordClientService,
    private readonly dealsService: DealsService,
    private readonly trackingService: TrackingService,
    private readonly postTemplate: PostTemplateService,
    private readonly marketplaceRegistry: MarketplaceAdapterRegistry,
    private readonly appConfig: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap() {
    this.discordClient.client.on('interactionCreate', (interaction: Interaction) => {
      if (!interaction.isButton()) {
        return;
      }

      // O handler nao pode lancar: uma excecao aqui vira unhandled rejection
      // dentro do event emitter do discord.js.
      this.handleButton(interaction).catch((error) => {
        this.logger.error(
          `Falha ao processar interacao ${interaction.customId}`,
          error as Error,
        );
      });
    });
  }

  private async handleButton(interaction: ButtonInteraction) {
    const [scope, action, dealId] = interaction.customId.split(':');

    if (scope !== 'deal' || !dealId) {
      return;
    }

    if (action === 'approve') {
      await this.onApprove(interaction, dealId);
      return;
    }

    if (action === 'reject') {
      await this.onReject(interaction, dealId);
    }
  }

  private async onApprove(interaction: ButtonInteraction, dealId: string) {
    // Gerar link de afiliado passa por chamada externa e pode demorar mais
    // que os 3s de limite do Discord para responder uma interacao.
    await interaction.deferReply();

    const deal = await this.dealsService.getDealWithOffer(dealId);
    if (!deal) {
      await interaction.editReply('Deal nao encontrado.');
      return;
    }

    const decidedBy = `${interaction.user.id}:${interaction.user.username}`;
    await this.trackingService.recordDecision({
      dealId,
      decision: DecisionType.APPROVE,
      decidedBy,
    });
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

    // wa.me (e nao o deep-link whatsapp://) porque a aprovacao acontece no
    // desktop, onde o destino e o WhatsApp Web.
    const whatsappWebUrl = this.postTemplate.buildWhatsappWebShareUrl(whatsappText);

    // Bloco de codigo para o texto sair com um botao de copiar nativo do
    // Discord, sem o markdown ser interpretado.
    await interaction.editReply(
      `✅ **Aprovado!**\n\n📋 Post pronto para o WhatsApp:\n\`\`\`\n${whatsappText}\n\`\`\`\n` +
        `🔗 Abrir no WhatsApp Web: ${whatsappWebUrl}`,
    );

    this.logger.log(`Deal ${dealId} aprovado. Link: ${finalLink}`);
  }

  private async onReject(interaction: ButtonInteraction, dealId: string) {
    const decidedBy = `${interaction.user.id}:${interaction.user.username}`;
    await this.trackingService.recordDecision({
      dealId,
      decision: DecisionType.REJECT,
      decidedBy,
    });

    // Efemera: rejeicao nao interessa a mais ninguem, nao precisa poluir o canal.
    await interaction.reply({
      content: '❌ Oferta rejeitada.',
      flags: MessageFlags.Ephemeral,
    });

    this.logger.log(`Deal ${dealId} rejeitado.`);
  }
}
