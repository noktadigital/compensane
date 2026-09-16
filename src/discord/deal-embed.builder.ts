import { Injectable } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { DealCardData } from '@/posts/post-template.service';

/** Verde: aprovar quase sem pensar. */
const COLOR_STRONG = 0x2ecc71;
/** Amarelo: vale olhar. */
const COLOR_MEDIUM = 0xf1c40f;
/** Vermelho: provavelmente nao vale. */
const COLOR_WEAK = 0xe74c3c;
/** Laranja: desconto anunciado nao bate com o real. */
const COLOR_FAKE_DISCOUNT = 0xe67e22;

/** Diferenca (em pontos percentuais) a partir da qual o desconto e suspeito. */
const FAKE_DISCOUNT_GAP_POINTS = 15;

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Monta o embed de aprovacao do Discord. Separado do servico que envia para
 * que a apresentacao possa mudar sem tocar em conexao/IO — e para poder ser
 * testado sem subir cliente do Discord.
 *
 * A cor da borda carrega informacao: da para bater o olho na lista de
 * ofertas e saber quais valem abrir, sem ler nada.
 */
@Injectable()
export class DealEmbedBuilder {
  build(dealId: string, data: DealCardData, imageUrl?: string | null) {
    const gapPoints = this.fakeDiscountGapPoints(data);
    const isSuspicious = gapPoints != null && gapPoints >= FAKE_DISCOUNT_GAP_POINTS;

    const embed = new EmbedBuilder()
      .setTitle(data.title.slice(0, 256)) // limite rigido do Discord
      .setURL(data.link)
      .setColor(isSuspicious ? COLOR_FAKE_DISCOUNT : this.colorForScore(data.dealScore))
      .addFields(
        { name: '💰 Preço', value: formatBRL(data.priceCents), inline: true },
        { name: '🎯 Deal Score', value: `${data.dealScore}/100`, inline: true },
      );

    // "Desconto real" so pode ser chamado assim quando saiu do NOSSO
    // historico. Sem serie propria, o unico numero disponivel e o da loja —
    // e rotula-lo como medicao nossa seria mentir para quem aprova.
    const temMedicaoPropria =
      data.advertisedDiscountRate != null && data.discountRate !== data.advertisedDiscountRate;

    if (data.discountRate && data.discountRate > 0) {
      embed.addFields({
        name: temMedicaoPropria ? '📉 Desconto real (medido)' : '📉 Desconto anunciado',
        value: temMedicaoPropria
          ? `${Math.round(data.discountRate * 100)}%`
          : `${Math.round(data.discountRate * 100)}% — sem histórico próprio ainda`,
        inline: true,
      });
    }

    // Repost de produto que a audiencia ja viu: o que justifica repetir e o
    // preco ter caido desde o ultimo envio.
    if (data.precoUltimoEnvioCents && data.precoUltimoEnvioCents > data.priceCents) {
      const queda = Math.round(
        ((data.precoUltimoEnvioCents - data.priceCents) / data.precoUltimoEnvioCents) * 100,
      );
      embed.addFields({
        name: '🔻 Baixou desde o último envio',
        value:
          `Era ${formatBRL(data.precoUltimoEnvioCents)}, agora ${formatBRL(data.priceCents)} ` +
          `(**${queda}% mais barato**)`,
        inline: false,
      });
    }

    // O confronto anunciado vs. real — razao de ser do sistema. Quando a
    // loja infla o numero, isso precisa saltar aos olhos antes da decisao.
    if (isSuspicious) {
      embed.addFields({
        name: '⚠️ DESCONTO INFLADO',
        value:
          `A loja anuncia **${Math.round((data.advertisedDiscountRate ?? 0) * 100)}% OFF**, ` +
          `mas contra o nosso histórico o desconto real é **${Math.round((data.discountRate ?? 0) * 100)}%**.`,
        inline: false,
      });
    }

    if (data.minPrice90dCents) {
      embed.addFields({
        name: '📊 Mínimo 90d',
        value: formatBRL(data.minPrice90dCents),
        inline: true,
      });
    }

    if (data.commissionCents) {
      embed.addFields({
        name: '💵 Comissão',
        value: formatBRL(data.commissionCents),
        inline: true,
      });
    }

    if (data.ratingStar) {
      embed.addFields({ name: '⭐ Nota', value: data.ratingStar.toFixed(1), inline: true });
    }

    if (data.salesCount != null) {
      embed.addFields({ name: '📦 Vendas', value: String(data.salesCount), inline: true });
    }

    // Sinais que nao reprovam a oferta mas quem aprova precisa ver.
    if (data.alertas?.length) {
      embed.addFields({
        name: '👀 Atenção',
        value: data.alertas.map((a) => `• ${a}`).join('\n'),
        inline: false,
      });
    }

    if (data.freeShipping) {
      embed.addFields({ name: '🚚 Frete', value: 'Grátis', inline: true });
    }

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deal:approve:${dealId}`)
        .setLabel('APROVAR')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`deal:reject:${dealId}`)
        .setLabel('REJEITAR')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setURL(data.link).setLabel('VER PRODUTO').setStyle(ButtonStyle.Link),
    );

    return { embeds: [embed], components: [buttons] };
  }

  /**
   * Diferenca em pontos percentuais entre o desconto anunciado e o real.
   * null quando nao da para comparar (loja nao anuncia desconto).
   */
  private fakeDiscountGapPoints(data: DealCardData): number | null {
    const advertised = data.advertisedDiscountRate;
    if (advertised == null || advertised <= 0) {
      return null;
    }
    return Math.round((advertised - (data.discountRate ?? 0)) * 100);
  }

  private colorForScore(score: number): number {
    if (score >= 85) return COLOR_STRONG;
    if (score >= 70) return COLOR_MEDIUM;
    return COLOR_WEAK;
  }
}
