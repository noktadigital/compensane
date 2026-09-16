import { Injectable } from '@nestjs/common';
import { RawMarketplaceOffer } from '@/marketplaces/core/marketplace-adapter.interface';

export interface QualityVerdict {
  /** Vale gravar no historico? Produto sem venda nenhuma e ruido. */
  valeMonitorar: boolean;
  /** Vale mandar para aprovacao AGORA? */
  valePublicar: boolean;
  /** Motivos de reprovacao, para log e diagnostico. */
  motivos: string[];
  /** Sinais de alerta que devem aparecer no card mesmo quando aprovada. */
  alertas: string[];
}

/**
 * Detecta oferta falsa SEM depender de historico proprio.
 *
 * Este servico existe porque a versao anterior do sistema so sabia afirmar
 * "desconto real" com 90 dias de serie propria — e por isso ficava mudo no
 * dia zero, descartando ofertas legitimas por falta de prova. Mas boa parte
 * da fraude e detectavel na hora, com o que a propria API entrega:
 *
 *   - desconto de 90% com ZERO vendas: preco "de" inflado, o golpe classico
 *   - faixa de preco larga (R$22 a R$59): o preco anunciado e da variante
 *     mais barata; quem compra o que quer paga o triplo
 *   - sem vendas e sem avaliacao: nao ha prova de que aquele preco e
 *     praticado por alguem
 *
 * O historico proprio continua sendo coletado e vira CONFIRMACAO no card
 * ("34% abaixo dos ultimos 30 dias") ou DESMENTIDO ("loja diz 60%, medimos
 * 8%") — deixa de ser pre-requisito e passa a ser reforco.
 */
@Injectable()
export class OfferQualityService {
  /** Abaixo disso nao e oferta, e preco normal. */
  private readonly DESCONTO_MIN = 0.25;
  /** Acima disso o preco "de" quase sempre e ficcao. */
  private readonly DESCONTO_SUSPEITO = 0.7;
  /**
   * Vendas que provam que o produto tem demanda real.
   *
   * Era 10, e o resultado foi um canal cheio de "Dedeira Moeda Antiga, 23
   * vendas" e "Botao de Air Fryer Mondial AF33, 21 vendas": itens de nicho
   * minusculo que ninguem na audiencia vai querer. 10 vendas nao provam
   * demanda, provam apenas que o produto existe.
   *
   * 1000 e sustentavel porque a busca agora ordena por vendas: medido, uma
   * pagina por categoria rende 992 ofertas acima desse corte. Antes, com a
   * ordenacao padrao, o catalogo inteiro tinha 12 itens com 300+ vendas.
   */
  private readonly VENDAS_MIN = 1000;
  /** Produto ruim barato nao e oferta. */
  private readonly NOTA_MIN = 4.5;
  /** priceMax ate 1,5x priceMin; acima disso o preco anunciado engana. */
  private readonly FAIXA_MAX = 1.5;
  /**
   * Abaixo disto nem vale ocupar espaco no banco. Mais alto que antes (1)
   * pelo mesmo motivo: serie de preco de produto sem demanda e lixo que
   * custa chamada de API no polling.
   */
  private readonly VENDAS_MIN_MONITORAR = 100;

  avaliar(offer: RawMarketplaceOffer): QualityVerdict {
    const motivos: string[] = [];
    const alertas: string[] = [];

    const vendas = offer.salesCount ?? 0;
    const nota = offer.ratingStar ?? 0;
    const desconto = offer.discountRate ?? 0;

    // --- Vale sequer guardar no historico? ---
    // Produto que ninguem compra nunca vai virar oferta util: guardar serie
    // de preco dele so infla o banco e gasta chamada de API no polling.
    const valeMonitorar = vendas >= this.VENDAS_MIN_MONITORAR;

    // --- Vale publicar agora? ---
    if (desconto < this.DESCONTO_MIN) {
      motivos.push(`desconto ${(desconto * 100).toFixed(0)}% abaixo do minimo de ${this.DESCONTO_MIN * 100}%`);
    }

    if (desconto >= this.DESCONTO_SUSPEITO) {
      motivos.push(
        `desconto de ${(desconto * 100).toFixed(0)}% e implausivel — preco "de" provavelmente inflado`,
      );
    }

    if (vendas < this.VENDAS_MIN) {
      motivos.push(`apenas ${vendas} vendas — sem prova de que o preco e praticado`);
    }

    if (nota < this.NOTA_MIN) {
      motivos.push(nota === 0 ? 'sem avaliacao' : `nota ${nota} abaixo de ${this.NOTA_MIN}`);
    }

    const faixa = this.faixaDePreco(offer);
    if (faixa && faixa.razao > this.FAIXA_MAX) {
      motivos.push(
        `faixa de preco larga (R$ ${(faixa.min / 100).toFixed(2)} a R$ ${(faixa.max / 100).toFixed(2)}) — ` +
          'o valor anunciado e o da variante mais barata',
      );
    }

    // --- Alertas que nao reprovam, mas devem aparecer no card ---
    if (desconto >= 0.55 && desconto < this.DESCONTO_SUSPEITO) {
      alertas.push(`Desconto alto (${(desconto * 100).toFixed(0)}%) — confira o preço na página`);
    }

    // Passou no corte, mas esta na borda: vale sinalizar sem reprovar.
    if (vendas >= this.VENDAS_MIN && vendas < this.VENDAS_MIN * 3) {
      alertas.push(`Poucas vendas (${vendas})`);
    }

    return { valeMonitorar, valePublicar: motivos.length === 0, motivos, alertas };
  }

  private faixaDePreco(offer: RawMarketplaceOffer): { min: number; max: number; razao: number } | null {
    const raw = offer.raw as Record<string, unknown> | undefined;
    if (!raw) return null;

    const min = Math.round(Number(raw.priceMin ?? 0) * 100);
    const max = Math.round(Number(raw.priceMax ?? 0) * 100);
    if (!min || !max || max <= min) return null;

    return { min, max, razao: max / min };
  }
}
