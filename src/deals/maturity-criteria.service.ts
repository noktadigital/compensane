import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';

export interface MaturityCriteria {
  /** Rotulo da fase, para log e para o card de aprovacao. */
  stage: 'cold-start' | 'inicial' | 'moderado' | 'maduro';
  /** Dias de historico que colocaram a oferta nesta fase. */
  daysWithData: number;
  /** Desconto real minimo exigido nesta fase. */
  minRealDiscount: number;
  /** Confianca minima exigida nesta fase. */
  minConfidence: number;
  /** Deal Score minimo para notificar nesta fase. */
  publishScore: number;
  /** Se o card deve sair marcado como "pouco historico". */
  lowConfidenceWarning: boolean;
}

/**
 * Criterio PROGRESSIVO por maturidade de historico.
 *
 * O problema que isto resolve: no dia zero, toda oferta tem 1 unico ponto de
 * historico. Com um ponto so, o preco de referencia É o preco atual, entao o
 * desconto real da sempre 0% e NENHUMA oferta pode passar — o sistema fica
 * matematicamente impossivel de satisfazer, e sem ofertas chegando nunca se
 * constroi historico nem se valida nada.
 *
 * A saida nao e afrouxar o criterio para sempre: e exigir MAIS conforme o
 * historico amadurece. Com pouco historico aceitamos menos evidencia, mas
 * marcamos o card como baixa confianca. Com historico maduro, o criterio
 * fica mais rigoroso que o original.
 *
 *   0-6 dias   (cold-start): desconto >= 25%, so o obvio passa; card marcado
 *   7-13 dias  (inicial)   : desconto >= 18%
 *   14-29 dias (moderado)  : desconto >= 12%
 *   30+ dias   (maduro)    : desconto >= configurado (padrao 10%), confianca alta
 *
 * Repare que o desconto exigido CAI conforme o historico cresce, mas a
 * confianca exigida SOBE. Nao e contraditorio: com 3 dias de dados, um
 * "desconto de 12%" pode ser ruido de amostragem, entao so aceitamos quedas
 * grandes o bastante para nao serem ruido. Com 30 dias, 10% ja e sinal real
 * — e ai passamos a cobrar que a serie sustente a afirmacao.
 */
@Injectable()
export class MaturityCriteriaService {
  private readonly configuredMinDiscount: number;
  private readonly configuredPublishScore: number;

  constructor(@Optional() appConfig?: AppConfigService) {
    this.configuredMinDiscount = appConfig?.dealRules.minRealDiscount ?? 0.1;
    this.configuredPublishScore = appConfig?.dealRules.publishScore ?? 70;
  }

  resolve(daysWithData: number): MaturityCriteria {
    if (daysWithData >= 30) {
      return {
        stage: 'maduro',
        daysWithData,
        minRealDiscount: this.configuredMinDiscount,
        minConfidence: 0.5,
        publishScore: this.configuredPublishScore,
        lowConfidenceWarning: false,
      };
    }

    if (daysWithData >= 14) {
      return {
        stage: 'moderado',
        daysWithData,
        minRealDiscount: Math.max(this.configuredMinDiscount, 0.12),
        minConfidence: 0.35,
        publishScore: this.configuredPublishScore,
        lowConfidenceWarning: false,
      };
    }

    if (daysWithData >= 7) {
      return {
        stage: 'inicial',
        daysWithData,
        minRealDiscount: Math.max(this.configuredMinDiscount, 0.18),
        minConfidence: 0.2,
        publishScore: this.configuredPublishScore,
        lowConfidenceWarning: true,
      };
    }

    // Cold start: exigimos uma queda grande o suficiente para nao ser ruido,
    // e nao cobramos confianca (ela e estruturalmente baixa aqui). O card sai
    // marcado para quem aprova saber que a referencia ainda e fraca.
    return {
      stage: 'cold-start',
      daysWithData,
      minRealDiscount: Math.max(this.configuredMinDiscount, 0.25),
      minConfidence: 0,
      publishScore: this.configuredPublishScore,
      lowConfidenceWarning: true,
    };
  }
}
