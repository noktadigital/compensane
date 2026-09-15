import { Injectable } from '@nestjs/common';

export interface PostTemplateData {
  title: string;
  priceCents: number;
  /** Preco de referencia apurado pelo nosso historico — vira o valor riscado. */
  referencePriceCents?: number | null;
  discountRate?: number | null;
  freeShipping?: boolean;
  link: string;
  ratingStar?: number | null;
  /** 1-2 beneficios do produto, escritos por quem aprova. */
  benefits?: string[];
}

export interface DealCardData extends PostTemplateData {
  dealScore: number;
  minPrice90dCents?: number | null;
  commissionCents?: number | null;
  /**
   * Desconto que o proprio marketplace anuncia (0-1). Existe para ser
   * CONFRONTADO com `discountRate` (o desconto real, medido pelo nosso
   * historico) — divergencia grande entre os dois e sinal de falso desconto.
   */
  advertisedDiscountRate?: number | null;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Centraliza todo texto voltado ao usuario final (secao 13): o card de
 * aprovacao e o post pronto para compartilhar no WhatsApp. Nenhum outro
 * modulo deve montar essas strings diretamente — isso evita texto
 * hardcoded espalhado pelo codigo e permite ajustar o tom/formato em um
 * unico lugar.
 *
 * Deliberadamente agnostico de canal: o texto nao sabe se vai para Discord,
 * Telegram ou qualquer outro lugar. Quem renderiza (ex: embed do Discord)
 * decide a apresentacao.
 */
@Injectable()
export class PostTemplateService {
  /** Card de aprovacao (texto puro), com Deal Score e dados de decisao. */
  buildDealCard(data: DealCardData): string {
    const lines = [`🔥 OFERTA ${data.dealScore}/100`, '', data.title, ''];

    lines.push(`💰 ${formatBRL(data.priceCents)}`);

    if (data.discountRate && data.discountRate > 0) {
      lines.push(`📉 ${Math.round(data.discountRate * 100)}% abaixo do preço normal`);
    }

    // Confronto entre o desconto anunciado pela loja e o real (medido pelo
    // nosso historico). So aparece quando a loja infla o numero de forma
    // relevante — e exatamente o "falso desconto" que o sistema existe para
    // pegar, entao precisa estar visivel na hora de decidir.
    const fakeDiscountGap = this.fakeDiscountGap(data);
    if (fakeDiscountGap) {
      lines.push(fakeDiscountGap);
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

  /**
   * Alerta de desconto inflado: compara o que a loja ANUNCIA com o desconto
   * REAL apurado pelo nosso historico de precos. Retorna null quando nao ha
   * dado suficiente ou quando os numeros batem — nao poluir o card com
   * alerta em oferta honesta e parte do ponto.
   *
   * O limiar de 15 pontos percentuais evita ruido de arredondamento e de
   * pequenas variacoes de preco de referencia.
   */
  private fakeDiscountGap(data: DealCardData): string | null {
    const advertised = data.advertisedDiscountRate;
    if (advertised == null || advertised <= 0) {
      return null;
    }

    const real = data.discountRate ?? 0;
    const gapPoints = Math.round((advertised - real) * 100);

    if (gapPoints < 15) {
      return null;
    }

    return `⚠️ Loja anuncia ${Math.round(advertised * 100)}% OFF, mas o real é ${Math.round(real * 100)}%`;
  }

  /**
   * Texto pronto para colar no WhatsApp, apos aprovacao.
   *
   * O preco anterior exibido e o preco de REFERENCIA apurado pelo nosso
   * historico — nunca o "de/por" anunciado pela loja. E essa a diferenca
   * entre divulgar um desconto real e repassar um falso desconto.
   */
  buildWhatsappPost(data: PostTemplateData): string {
    const lines = ['🔥 OFERTA QUE COMPENSA!', '', `🛍️ ${data.title}`, '', `💰 ${formatBRL(data.priceCents)}`];

    // ~texto~ e o riscado do WhatsApp.
    if (data.referencePriceCents && data.referencePriceCents > data.priceCents) {
      const offPercent = Math.round(
        ((data.referencePriceCents - data.priceCents) / data.referencePriceCents) * 100,
      );
      lines.push(`~${formatBRL(data.referencePriceCents)}~ | ${offPercent}% OFF`);
    }

    if (data.benefits?.length) {
      lines.push('', ...data.benefits.map((benefit) => `✅ ${benefit}`));
    } else if (data.freeShipping) {
      lines.push('', '🚚 Frete grátis');
    }

    lines.push('', '👉 COMPRAR AGORA:', data.link, '', '⏳ Preço e disponibilidade podem mudar a qualquer momento.');

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
