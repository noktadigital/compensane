import { PostTemplateService } from './post-template.service';

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

describe('PostTemplateService', () => {
  let service: PostTemplateService;

  beforeEach(() => {
    service = new PostTemplateService();
  });

  it('monta o card de aprovacao com score, preco, desconto, comissao e frete gratis', () => {
    const card = service.buildDealCard({
      title: 'Whey Dark Lab Isolate Protein Fuse 1,8kg',
      priceCents: 17090,
      discountRate: 0.24,
      freeShipping: true,
      link: 'https://shopee.com.br/product/1/2',
      dealScore: 91,
      minPrice90dCents: 16500,
      commissionCents: 1368,
      ratingStar: 4.8,
    });

    expect(card).toContain('🔥 OFERTA 91/100');
    expect(card).toContain('Whey Dark Lab Isolate Protein Fuse 1,8kg');
    expect(card).toContain(brl(17090));
    expect(card).toContain('24% abaixo do preço normal');
    expect(card).toContain(brl(16500));
    expect(card).toContain(brl(1368));
    expect(card).toContain('🚚 Frete grátis');
    expect(card).toContain('⭐ 4.8');
  });

  it('omite linhas opcionais quando os dados nao estao presentes', () => {
    const card = service.buildDealCard({
      title: 'Produto simples',
      priceCents: 1000,
      dealScore: 75,
      link: 'https://example.com',
    });

    expect(card).not.toContain('Frete grátis');
    expect(card).not.toContain('Comissão');
    expect(card).not.toContain('Mínimo 90d');
  });

  it('monta o texto de WhatsApp com preco riscado e percentual de desconto', () => {
    const text = service.buildWhatsappPost({
      title: 'Whey Dark Lab Isolate Protein Fuse 1,8kg',
      priceCents: 17090,
      originalPriceCents: 22490,
      discountRate: 0.24,
      freeShipping: true,
      link: 'https://achadinhos.app/r/abc123',
    });

    expect(text).toContain('🔥 OFERTA QUE COMPENSA!');
    expect(text).toContain('🛍️ Whey Dark Lab Isolate Protein Fuse 1,8kg');
    expect(text).toContain(brl(17090));
    // Riscado do WhatsApp (~texto~) com o preco de referencia do historico.
    expect(text).toContain(`~${brl(22490)}~`);
    expect(text).toContain('24% OFF');
    expect(text).toContain('👉 COMPRAR AGORA:');
    expect(text).toContain('https://achadinhos.app/r/abc123');
    expect(text).toContain('⏳ Preço e disponibilidade podem mudar a qualquer momento.');
  });

  it('usa os beneficios informados no lugar da linha de frete', () => {
    const text = service.buildWhatsappPost({
      title: 'Fone Bluetooth TWS',
      priceCents: 7000,
      originalPriceCents: 10000,
      freeShipping: true,
      benefits: ['Bateria de 30h', 'Cancelamento de ruído'],
      link: 'https://achadinhos.app/r/xyz',
    });

    expect(text).toContain('✅ Bateria de 30h');
    expect(text).toContain('✅ Cancelamento de ruído');
    expect(text).not.toContain('🚚 Frete grátis');
  });

  it('omite o preco riscado quando a loja nao anuncia preco "de"', () => {
    const text = service.buildWhatsappPost({
      title: 'Produto sem desconto anunciado',
      priceCents: 5000,
      link: 'https://achadinhos.app/r/sem-ref',
    });

    expect(text).not.toContain('~');
    expect(text).not.toContain('OFF');
    expect(text).toContain(brl(5000));
  });

  it('gera URL encoded para compartilhamento no WhatsApp (deep link e web)', () => {
    const text = 'Oferta especial: R$ 10,00 https://achadinhos.app/r/abc';
    const deepLink = service.buildWhatsappShareUrl(text);
    const webLink = service.buildWhatsappWebShareUrl(text);

    expect(deepLink).toBe(`whatsapp://send?text=${encodeURIComponent(text)}`);
    expect(webLink).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(deepLink).not.toContain(' ');
  });
});
