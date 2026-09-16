import { DealEmbedBuilder } from './deal-embed.builder';
import { DealCardData } from '@/posts/post-template.service';

function card(over: Partial<DealCardData> = {}): DealCardData {
  return {
    title: 'Produto de teste',
    priceCents: 10000,
    link: 'https://example.com/r/abc',
    dealScore: 45,
    ...over,
  };
}

/** Extrai os campos do embed como pares nome/valor, para assercao legivel. */
function fields(payload: ReturnType<DealEmbedBuilder['build']>) {
  const data = payload.embeds[0].toJSON();
  return (data.fields ?? []).map((f) => ({ name: f.name, value: f.value }));
}

describe('DealEmbedBuilder', () => {
  let builder: DealEmbedBuilder;

  beforeEach(() => {
    builder = new DealEmbedBuilder();
  });

  describe('confronto entre desconto anunciado e medido', () => {
    it('acusa desconto inflado quando a loja diverge do nosso historico', () => {
      const payload = builder.build(
        'deal-1',
        card({ discountRate: 0.09, advertisedDiscountRate: 0.6 }),
      );

      const alerta = fields(payload).find((f) => f.name.includes('DESCONTO INFLADO'));
      expect(alerta).toBeDefined();
      expect(alerta!.value).toMatch(/60%/);
      expect(alerta!.value).toMatch(/9%/);
    });

    it('NAO acusa nada quando ainda nao ha medicao propria', () => {
      // Regressao: o fluxo de descoberta passava o MESMO numero nos dois
      // campos, o que zerava a diferenca e fazia o alerta nunca disparar —
      // o diferencial do sistema ficava inerte sem ninguem perceber.
      const payload = builder.build(
        'deal-2',
        card({ discountRate: 0.5, advertisedDiscountRate: 0.5 }),
      );

      const nomes = fields(payload).map((f) => f.name);
      expect(nomes.some((n) => n.includes('DESCONTO INFLADO'))).toBe(false);
      // E o rotulo deixa claro que o numero e da loja, nao nosso.
      expect(nomes).toContain('📉 Desconto anunciado');
      expect(nomes).not.toContain('📉 Desconto real (medido)');
    });

    it('rotula como medido quando os dois numeros existem e diferem', () => {
      const payload = builder.build(
        'deal-3',
        card({ discountRate: 0.34, advertisedDiscountRate: 0.4 }),
      );

      expect(fields(payload).map((f) => f.name)).toContain('📉 Desconto real (medido)');
    });
  });

  describe('repost de oferta ja enviada', () => {
    it('destaca a queda quando o preco caiu desde o ultimo envio', () => {
      const payload = builder.build(
        'deal-4',
        card({ priceCents: 7500, precoUltimoEnvioCents: 10000 }),
      );

      const queda = fields(payload).find((f) => f.name.includes('Baixou desde'));
      expect(queda).toBeDefined();
      expect(queda!.value).toMatch(/25% mais barato/);
    });

    it('omite o destaque quando o preco nao caiu', () => {
      const payload = builder.build(
        'deal-5',
        card({ priceCents: 10000, precoUltimoEnvioCents: 9000 }),
      );

      expect(fields(payload).some((f) => f.name.includes('Baixou desde'))).toBe(false);
    });
  });

  it('mostra vendas e alertas de qualidade', () => {
    const payload = builder.build(
      'deal-6',
      card({ salesCount: 254, alertas: ['Poucas vendas (15)'] }),
    );

    const f = fields(payload);
    expect(f.find((x) => x.name.includes('Vendas'))!.value).toBe('254');
    expect(f.find((x) => x.name.includes('Atenção'))!.value).toMatch(/Poucas vendas/);
  });
});
