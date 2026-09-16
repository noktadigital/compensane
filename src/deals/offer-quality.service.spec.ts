import { Marketplace } from '@prisma/client';
import { OfferQualityService } from './offer-quality.service';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';

function oferta(over: Partial<RawMarketplaceOffer> & { priceMin?: number; priceMax?: number } = {}) {
  const { priceMin, priceMax, ...rest } = over;
  return {
    marketplace: Marketplace.SHOPEE,
    externalId: '1',
    title: 'Produto',
    url: 'https://shopee.com.br/product/1/1',
    priceCents: 10000,
    inStock: true,
    discountRate: 0.35,
    salesCount: 5000,
    ratingStar: 4.8,
    raw: { priceMin: priceMin ?? 100, priceMax: priceMax ?? 100 },
    ...rest,
  } as RawMarketplaceOffer;
}

describe('OfferQualityService', () => {
  let service: OfferQualityService;

  beforeEach(() => {
    service = new OfferQualityService();
  });

  it('aprova oferta com desconto plausivel, vendas e boa nota', () => {
    const v = service.avaliar(oferta());
    expect(v.valePublicar).toBe(true);
    expect(v.motivos).toEqual([]);
  });

  it('reprova desconto implausivel mesmo com tudo o mais em ordem', () => {
    // 90% OFF e o golpe classico do preco "de" inflado.
    const v = service.avaliar(oferta({ discountRate: 0.9 }));
    expect(v.valePublicar).toBe(false);
    expect(v.motivos.join()).toMatch(/implausivel/);
  });

  it('reprova produto sem vendas — nao ha prova de que o preco e praticado', () => {
    const v = service.avaliar(oferta({ salesCount: 0 }));
    expect(v.valePublicar).toBe(false);
    expect(v.motivos.join()).toMatch(/vendas/);
  });

  it('reprova faixa de preco larga (golpe da variante barata)', () => {
    // Anuncia R$22,98 mas a variante util custa R$59,98.
    const v = service.avaliar(oferta({ priceMin: 22.98, priceMax: 59.98 }));
    expect(v.valePublicar).toBe(false);
    expect(v.motivos.join()).toMatch(/faixa de preco larga/);
  });

  it('aceita variacao pequena de preco entre variantes', () => {
    const v = service.avaliar(oferta({ priceMin: 100, priceMax: 140 }));
    expect(v.valePublicar).toBe(true);
  });

  it('reprova nota baixa e sinaliza ausencia de avaliacao', () => {
    expect(service.avaliar(oferta({ ratingStar: 3.2 })).valePublicar).toBe(false);
    expect(service.avaliar(oferta({ ratingStar: 0 })).motivos.join()).toMatch(/sem avaliacao/);
  });

  it('nao monitora produto sem demanda — historico dele e lixo', () => {
    // Serie de preco de item que ninguem compra custa chamada de API no
    // polling e nunca vira oferta util.
    expect(service.avaliar(oferta({ salesCount: 0 })).valeMonitorar).toBe(false);
    expect(service.avaliar(oferta({ salesCount: 23 })).valeMonitorar).toBe(false);
    expect(service.avaliar(oferta({ salesCount: 500 })).valeMonitorar).toBe(true);
  });

  it('alerta sobre desconto alto e poucas vendas sem reprovar', () => {
    const alto = service.avaliar(oferta({ discountRate: 0.6 }));
    expect(alto.valePublicar).toBe(true);
    expect(alto.alertas.join()).toMatch(/Desconto alto/);

    const poucas = service.avaliar(oferta({ salesCount: 1500 }));
    expect(poucas.valePublicar).toBe(true);
    expect(poucas.alertas.join()).toMatch(/Poucas vendas/);
  });
});
