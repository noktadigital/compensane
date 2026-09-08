import { Injectable } from '@nestjs/common';

export interface PostTemplateData {
  title: string;
  priceCents: number;
  discountRate?: number | null;
  freeShipping?: boolean;
  link: string;
  ratingStar?: number | null;
}

export interface TelegramCardData extends PostTemplateData {
  dealScore: number;
  minPrice90dCents?: number | null;
  commissionCents?: number | null;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Centraliza todo texto voltado ao usuario final (secao 13): o card enviado
 * no Telegram e o post pronto para compartilhar no WhatsApp. Nenhum outro
 * modulo deve montar essas strings diretamente — isso evita texto
 * hardcoded espalhado pelo codigo e permite ajustar o tom/formato em um
 * unico lugar.
 */
@Injectable()
export class PostTemplateService {
  /** Card enviado ao aprovador no Telegram, com Deal Score e dados de decisao. */
  buildTelegramCard(data: TelegramCardData): string {
    const lines = [`🔥 OFERTA ${data.dealScore}/100`, '', data.title, ''];

    lines.push(`💰 ${formatBRL(data.priceCents)}`);

    if (data.discountRate && data.discountRate > 0) {
      lines.push(`📉 ${Math.round(data.discountRate * 100)}% abaixo do preço normal`);
    }

    if (data.minPrice90dCents) {
      lines.push(`📊 Mínimo 90d: ${formatBRL(data.minPrice90dCents)}`);
    }

    if (data.commissionCents) {
      lines.push(`💵 Comissão: ${formatBRL(data.commissionCents)}`);
    }

    if (data.freeShipping) {
      lines.push('🚚 Frete grátis');
    }

    if (data.ratingStar) {
      lines.push(`⭐ ${data.ratingStar.toFixed(1)}`);
    }

    return lines.join('\n');
  }

  /** Texto pronto para compartilhamento no WhatsApp, apos aprovacao. */
  buildWhatsappPost(data: PostTemplateData): string {
    const lines = ['🔥 OFERTA RELÂMPAGO', '', data.title, '', `💰 ${formatBRL(data.priceCents)}`, ''];

    if (data.discountRate && data.discountRate > 0) {
      lines.push('📉 Está abaixo do preço normal');
    }

    if (data.freeShipping) {
      lines.push('🚚 Frete grátis');
    }

    lines.push('', '👇 Aproveite:', data.link, '', '⚠️ Preço e estoque podem mudar.');

    return lines.join('\n');
  }

  /** Monta a URL de deep-link do WhatsApp com o texto ja URL-encoded. */
  buildWhatsappShareUrl(text: string): string {
    return `whatsapp://send?text=${encodeURIComponent(text)}`;
  }

  /** Fallback web (wa.me) para quando o deep-link nativo nao estiver disponivel. */
  buildWhatsappWebShareUrl(text: string): string {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
}
