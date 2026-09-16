import { MaturityCriteriaService } from './maturity-criteria.service';

describe('MaturityCriteriaService', () => {
  let service: MaturityCriteriaService;

  beforeEach(() => {
    // Sem AppConfigService: cai nos padroes (minRealDiscount 0.10, publish 70).
    service = new MaturityCriteriaService();
  });

  it('no dia zero exige desconto grande e nao cobra confianca', () => {
    const criteria = service.resolve(1);

    expect(criteria.stage).toBe('cold-start');
    expect(criteria.minRealDiscount).toBe(0.25);
    // Confianca e estruturalmente baixa com 1 ponto — cobra-la aqui tornaria
    // o sistema impossivel de satisfazer.
    expect(criteria.minConfidence).toBe(0);
    expect(criteria.lowConfidenceWarning).toBe(true);
  });

  it('afrouxa o desconto exigido conforme o historico cresce', () => {
    const coldStart = service.resolve(3);
    const inicial = service.resolve(7);
    const moderado = service.resolve(14);
    const maduro = service.resolve(30);

    expect(coldStart.minRealDiscount).toBe(0.25);
    expect(inicial.minRealDiscount).toBe(0.18);
    expect(moderado.minRealDiscount).toBe(0.12);
    expect(maduro.minRealDiscount).toBe(0.1);

    // Monotonicamente decrescente: mais dados, menos desconto necessario para
    // afirmar que a queda e real.
    expect(coldStart.minRealDiscount).toBeGreaterThan(inicial.minRealDiscount);
    expect(inicial.minRealDiscount).toBeGreaterThan(moderado.minRealDiscount);
    expect(moderado.minRealDiscount).toBeGreaterThan(maduro.minRealDiscount);
  });

  it('aperta a confianca exigida conforme o historico cresce', () => {
    // Espelho do teste anterior: o que afrouxa e o desconto, o que aperta e a
    // exigencia de que a serie sustente a afirmacao.
    expect(service.resolve(3).minConfidence).toBe(0);
    expect(service.resolve(7).minConfidence).toBe(0.2);
    expect(service.resolve(14).minConfidence).toBe(0.35);
    expect(service.resolve(30).minConfidence).toBe(0.5);
  });

  it('marca baixa confianca so nas fases iniciais', () => {
    expect(service.resolve(3).lowConfidenceWarning).toBe(true);
    expect(service.resolve(7).lowConfidenceWarning).toBe(true);
    expect(service.resolve(14).lowConfidenceWarning).toBe(false);
    expect(service.resolve(30).lowConfidenceWarning).toBe(false);
  });

  it('nunca fica abaixo do minimo configurado, mesmo na fase madura', () => {
    const strict = new MaturityCriteriaService({
      dealRules: { minRealDiscount: 0.2, publishScore: 75 },
    } as never);

    // Config mais rigorosa que os pisos das fases deve prevalecer.
    expect(strict.resolve(30).minRealDiscount).toBe(0.2);
    expect(strict.resolve(14).minRealDiscount).toBe(0.2);
    expect(strict.resolve(3).minRealDiscount).toBe(0.25);
    expect(strict.resolve(30).publishScore).toBe(75);
  });

  it('classifica as fases pelos limites corretos', () => {
    expect(service.resolve(0).stage).toBe('cold-start');
    expect(service.resolve(6).stage).toBe('cold-start');
    expect(service.resolve(7).stage).toBe('inicial');
    expect(service.resolve(13).stage).toBe('inicial');
    expect(service.resolve(14).stage).toBe('moderado');
    expect(service.resolve(29).stage).toBe('moderado');
    expect(service.resolve(30).stage).toBe('maduro');
    expect(service.resolve(365).stage).toBe('maduro');
  });
});
