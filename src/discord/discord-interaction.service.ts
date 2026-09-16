import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ButtonInteraction, ChannelType, Interaction, MessageFlags } from 'discord.js';
import { DecisionType } from '@prisma/client';
import { DealsService } from '@/deals/deals.service';
import { TrackingService } from '@/tracking/tracking.service';
import { PostTemplateService } from '@/posts/post-template.service';
import { MarketplaceAdapterRegistry } from '@/marketplaces/core/marketplace-adapter.registry';
import { PrismaService } from '@/database/prisma.service';
import { DiscordClientService } from './discord-client.service';
import { PostChannelService } from './post-channel.service';

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
    private readonly postChannels: PostChannelService,
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

    if (!dealId) {
      return;
    }

    if (scope === 'post' && action === 'close') {
      await this.onClosePost(interaction, dealId);
      return;
    }

    if (scope !== 'deal') {
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
    //
    // Efemera: no caminho feliz o post vai para o canal proprio e esta
    // resposta e descartada. Publica, ela apareceria e sumiria no meio da
    // fila de cards — exatamente a poluicao visual que se quer evitar.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    // O post vai para um canal proprio na barra lateral, nao para o meio da
    // fila de cards: o fluxo e aprovar varias ofertas em sequencia e so
    // depois postar uma a uma, e para isso cada post pendente precisa ser
    // visivel sem abrir o canal de ofertas.
    const canalDoPost =
      interaction.guild && interaction.channel && 'parentId' in interaction.channel
        ? await this.postChannels.abrir({
            dealId,
            titulo: deal.productOffer.product.title,
            postText: whatsappText,
            guild: interaction.guild,
            parentId: interaction.channel.parentId,
          })
        : null;

    if (!canalDoPost) {
      // Sem canal (permissao faltando ou teto atingido) o post nao pode
      // simplesmente sumir — cai aqui mesmo, como antes.
      await interaction.editReply(
        `Nao consegui abrir o canal do post (permissao ou limite). Segue aqui:\n` +
          `\`\`\`\n${whatsappText}\n\`\`\``,
      );
      return;
    }

    // O card cumpriu o papel: sai do canal para a fila mostrar so o que
    // ainda falta decidir.
    await interaction.editReply(`Post pronto em <#${canalDoPost.id}>.`);
    await interaction.message.delete().catch((error) => {
      this.logger.warn(
        `Nao foi possivel apagar o card do deal ${dealId}: ${(error as Error).message}`,
      );
    });

    this.logger.log(`Deal ${dealId} aprovado. Link: ${finalLink}`);
  }

  /**
   * ENCERRAR: apaga o canal do post.
   *
   * Nao ha o que responder ao usuario — o canal inteiro desaparece, entao
   * qualquer editReply morreria junto. Por isso deferUpdate e delete direto.
   */
  private async onClosePost(interaction: ButtonInteraction, dealId: string) {
    const canal = interaction.channel;

    if (!canal || canal.type !== ChannelType.GuildText) {
      return;
    }

    try {
      await interaction.deferUpdate();
      await this.postChannels.encerrar(canal);
      this.logger.log(`Canal do post do deal ${dealId} encerrado.`);
    } catch (error) {
      this.logger.error(
        `Falha ao encerrar canal do deal ${dealId}: ${(error as Error).message}`,
      );
    }
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
