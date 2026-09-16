import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ButtonInteraction, Interaction } from 'discord.js';
import { DecisionType } from '@prisma/client';
import { DealsService } from '@/deals/deals.service';
import { TrackingService } from '@/tracking/tracking.service';
import { PostTemplateService } from '@/posts/post-template.service';
import { MarketplaceAdapterRegistry } from '@/marketplaces/core/marketplace-adapter.registry';
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

    // O link que vai para a audiencia e o encurtado da PROPRIA Shopee, nao o
    // nosso redirecionador. Um dominio desconhecido colado num grupo de
    // WhatsApp parece phishing e destroi a confianca — e o s.shopee.com.br
    // ja e um link de afiliado com subId, entao nada de atribuicao se perde.
    //
    // Resolvido ANTES de registrar a decisao: sem link nao ha post, e marcar
    // o deal como publicado nesse caso deixaria uma aprovacao fantasma que
    // bloqueia o botao numa segunda tentativa.
    const finalLink = await this.resolveShortLink(deal);

    if (!finalLink) {
      await interaction.editReply(
        'Nao consegui gerar o link encurtado da Shopee agora. Clique em aprovar ' +
          'de novo em instantes — o post nao sai com link longo de proposito.',
      );
      return;
    }

    const decidedBy = `${interaction.user.id}:${interaction.user.username}`;
    await this.trackingService.recordDecision({
      dealId,
      decision: DecisionType.APPROVE,
      decidedBy,
    });
    await this.dealsService.markPublished(dealId);

    // O valor riscado do post e o preco "de" da LOJA, nao o nosso preco de
    // referencia: o cliente abre o link e confere os numeros na pagina do
    // produto. Ele vive na observacao de preco mais recente, nao no Deal.
    const latestObservation = await this.prisma.priceObservation.findFirst({
      where: { productOfferId: deal.productOfferId },
      orderBy: { observedAt: 'desc' },
      select: { originalPriceCents: true },
    });

    const whatsappText = this.postTemplate.buildWhatsappPost({
      title: deal.productOffer.product.title,
      priceCents: deal.priceCents,
      originalPriceCents: latestObservation?.originalPriceCents,
      discountRate: deal.discountRate,
      freeShipping: deal.freeShipping,
      link: finalLink,
    });

    // Bloco de codigo para o texto sair com um botao de copiar nativo do
    // Discord, sem o markdown ser interpretado. Nada alem disso: o fluxo e
    // copiar e colar no grupo, e qualquer linha extra so ocupa a tela.
    await interaction.editReply(`\`\`\`\n${whatsappText}\n\`\`\``);

    this.logger.log(`Deal ${dealId} aprovado. Link: ${finalLink}`);
  }

  /**
   * O link encurtado da Shopee para este deal — e so ele.
   *
   * A descoberta ja gerou e guardou um shortLink quando montou o card, entao
   * aqui reusamos em vez de chamar generateShortLink de novo: a segunda
   * chamada gastava cota da API, criava uma linha duplicada em AffiliateLink
   * e, quando falhava, caia no offerLink longo do catalogo (sem subId) — ou
   * seja, justamente o link feio e sem atribuicao que nao queremos publicar.
   *
   * So gera na hora se nao houver nada guardado. Se nem assim vier um
   * shortLink, devolve null: melhor o post nao sair do que sair com URL longa.
   */
  private async resolveShortLink(
    deal: NonNullable<Awaited<ReturnType<DealsService['getDealWithOffer']>>>,
  ): Promise<string | null> {
    const existente = await this.prisma.affiliateLink.findFirst({
      where: { dealId: deal.id, shortLink: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { shortLink: true },
    });

    if (existente?.shortLink) {
      return existente.shortLink;
    }

    const adapter = this.marketplaceRegistry.get(deal.productOffer.marketplace);

    try {
      const gerado = await adapter.generateAffiliateLink({
        marketplace: deal.productOffer.marketplace,
        externalId: deal.productOffer.externalId,
        title: deal.productOffer.product.title,
        url: deal.productOffer.url,
        priceCents: deal.priceCents,
        inStock: true,
      });

      if (!gerado.shortLink) {
        return null;
      }

      await this.prisma.affiliateLink.create({
        data: {
          dealId: deal.id,
          productOfferId: deal.productOffer.id,
          originalLink: gerado.originalLink,
          shortLink: gerado.shortLink,
          subId: gerado.subId,
        },
      });

      return gerado.shortLink;
    } catch (error) {
      this.logger.error(
        `Falha ao gerar link encurtado do deal ${deal.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Rejeitar apaga o card do canal, sem deixar mensagem no lugar.
   *
   * O canal e uma fila de trabalho, nao um historico: o que foi recusado so
   * ocupa espaco e atrapalha a leitura do que ainda falta decidir. O registro
   * da decisao fica no banco (DealDecision), nao no Discord.
   */
  private async onReject(interaction: ButtonInteraction, dealId: string) {
    const decidedBy = `${interaction.user.id}:${interaction.user.username}`;
    await this.trackingService.recordDecision({
      dealId,
      decision: DecisionType.REJECT,
      decidedBy,
    });

    await this.dealsService.markRejected(dealId);

    try {
      // deferUpdate reconhece o clique sem postar nada; sem isso o Discord
      // marca a interacao como falha depois de 3s.
      await interaction.deferUpdate();
      await interaction.message.delete();
    } catch (error) {
      // Mensagem ja apagada ou sem permissao: a decisao ja foi gravada, entao
      // isto nao pode virar erro para o usuario.
      this.logger.warn(
        `Nao foi possivel apagar o card do deal ${dealId}: ${(error as Error).message}`,
      );
    }

    this.logger.log(`Deal ${dealId} rejeitado.`);
  }
}
