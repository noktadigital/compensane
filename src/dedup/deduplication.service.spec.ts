import { DeduplicationService } from './deduplication.service';

describe('DeduplicationService', () => {
  let service: DeduplicationService;

  beforeEach(() => {
    service = new DeduplicationService();
  });

  it('usa GTIN como chave quando disponivel', () => {
    const key = service.buildProductKey({ gtin: '7891234567890', title: 'Produto X', brand: 'Marca' });
    expect(key).toBe('gtin:7891234567890');
  });

  it('gera a mesma chave para titulos equivalentes (case/acentuacao/espacos diferentes)', () => {
    const key1 = service.buildProductKey({ title: 'Whey Protein Isolado 900g', brand: 'Dark Lab' });
    const key2 = service.buildProductKey({ title: '  whey   protein isolado 900g  ', brand: 'dark lab' });
    const key3 = service.buildProductKey({ title: 'WHEY PRÓTEIN ISOLADO 900G', brand: 'Dark Lab' });

    expect(key1).toBe(key2);
    expect(key1).toBe(key3);
  });

  it('gera chaves diferentes para produtos com titulos diferentes', () => {
    const key1 = service.buildProductKey({ title: 'Whey Protein 900g', brand: 'Dark Lab' });
    const key2 = service.buildProductKey({ title: 'Creatina 300g', brand: 'Growth' });

    expect(key1).not.toBe(key2);
  });

  it('nao funde ofertas de vendedores diferentes na chave unica de oferta', () => {
    const key1 = service.buildOfferUniqueKey('SHOPEE', 'item-1');
    const key2 = service.buildOfferUniqueKey('SHOPEE', 'item-2');

    expect(key1).not.toBe(key2);
  });
});
