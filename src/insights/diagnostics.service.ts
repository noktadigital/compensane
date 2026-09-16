import { Injectable } from '@nestjs/common';
import { DealStatus, Marketplace } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { MaturityCriteriaService } from '@/deals/maturity-criteria.service';

export interface PipelineDiagnostics {
  coleta: {
    ofertasAtivas: number;
    ofertasSemHistorico: number;
    ultimaColeta: string | null;
    observacoesTotais: number;
    diasAgregados: number;
  };
  historico: {
    /** Quantas ofertas tem N dias de historico — mostra se a serie esta crescendo. */
    distribuicaoDias: { dias: number; ofertas: number }[];
    fasePredominante: string;
  };
  deals: {
    detectados: number;
    publicados: number;
    expirados: number;
  };
  /** Ofertas mais proximas de virar Deal, com o que falta em cada uma. */
  quaseLa: {
    produto: string;
    precoAtual: string;
    referencia: string;
    descontoReal: string;
    exigido: string;
    diasHistorico: number;
    falta: string;
  }[];
}

/**
 * Responde "o sistema esta funcionando?" em uma chamada.
 *
 * Existe porque, sem isso, a unica forma de saber se a coleta estava servindo
 * para alguma coisa era rodar SQL no banco. O sistema pode estar coletando
 * perfeitamente e mesmo assim nao gerar nenhum card — e sem visibilidade isso
 * e indistinguivel de estar quebrado.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maturity: MaturityCriteriaService,
  ) {}

  async getPipelineDiagnostics(): Promise<PipelineDiagnostics> {
    const [ofertasAtivas, observacoesTotais, diasAgregados, ultimaObs] = await Promise.all([
      this.prisma.productOffer.count({ where: { active: true, externalId: { not: { startsWith: 'mock-' } } } }),
      this.prisma.priceObservation.count(),
      this.prisma.dailyPriceAggregate.count(),
      this.prisma.priceObservation.findFirst({
        orderBy: { observedAt: 'desc' },
        select: { observedAt: true },
      }),
    ]);

    const ofertasSemHistorico = await this.prisma.productOffer.count({
      where: { active: true, externalId: { not: { startsWith: 'mock-' } }, dailyPriceAggregates: { none: {} } },
    });

    const [detectados, publicados, expirados] = await Promise.all([
      this.prisma.deal.count({ where: { status: DealStatus.DETECTED } }),
      this.prisma.deal.count({ where: { status: DealStatus.PUBLISHED } }),
      this.prisma.deal.count({ where: { status: DealStatus.EXPIRED } }),
    ]);

    const distribuicaoDias = await this.distribuicaoDias();
    const diasMediano = this.medianaDeDias(distribuicaoDias);
    const fase = this.maturity.resolve(diasMediano);

    return {
      coleta: {
        ofertasAtivas,
        ofertasSemHistorico,
        ultimaColeta: ultimaObs?.observedAt.toISOString() ?? null,
        observacoesTotais,
        diasAgregados,
      },
      historico: {
        distribuicaoDias,
        fasePredominante: `${fase.stage} (${diasMediano}d) — exige desconto >= ${(fase.minRealDiscount * 100).toFixed(0)}%`,
      },
      deals: { detectados, publicados, expirados },
      quaseLa: await this.ofertasQuaseLa(),
    };
  }

  /** Quantas ofertas tem N dias de historico. */
  private async distribuicaoDias(): Promise<{ dias: number; ofertas: number }[]> {
    const rows = await this.prisma.$queryRaw<{ dias: bigint; ofertas: bigint }[]>`
      SELECT dias, COUNT(*)::bigint AS ofertas FROM (
        SELECT "productOfferId", COUNT(*)::bigint AS dias
        FROM "DailyPriceAggregate" GROUP BY "productOfferId"
      ) t GROUP BY dias ORDER BY dias`;

    return rows.map((r) => ({ dias: Number(r.dias), ofertas: Number(r.ofertas) }));
  }

  private medianaDeDias(dist: { dias: number; ofertas: number }[]): number {
    const total = dist.reduce((s, d) => s + d.ofertas, 0);
    if (total === 0) return 0;

    let acumulado = 0;
    for (const d of dist) {
      acumulado += d.ofertas;
      if (acumulado >= total / 2) return d.dias;
    }
    return 0;
  }

  /**
   * Ofertas ordenadas por quao perto estao de virar Deal. Mostra o desconto
   * real medido contra o exigido pela fase — assim da para ver se o sistema
   * esta "quase la" ou se nao ha nada acontecendo.
   */
  private async ofertasQuaseLa(): Promise<PipelineDiagnostics['quaseLa']> {
    const candidatas = await this.prisma.productOffer.findMany({
      where: { active: true, externalId: { not: { startsWith: 'mock-' } }, dailyPriceAggregates: { some: {} } },
      include: {
        product: { select: { title: true } },
        dailyPriceAggregates: { orderBy: { day: 'desc' }, take: 90 },
      },
      take: 200,
    });

    const avaliadas = candidatas
      .map((offer) => {
        const dias = offer.dailyPriceAggregates.length;
        const precos = offer.dailyPriceAggregates.map((a) => a.closePriceCents);
        const atual = precos[0];
        if (!atual) return null;

        // Referencia simplificada (mediana) — o calculo oficial e do
        // PriceReferenceService; aqui so precisamos de uma ordenacao.
        const ordenado = [...precos].sort((a, b) => a - b);
        const referencia = ordenado[Math.floor(ordenado.length / 2)];
        const desconto = referencia > 0 ? (referencia - atual) / referencia : 0;
        const criterio = this.maturity.resolve(dias);
        const gap = criterio.minRealDiscount - desconto;

        return {
          produto: offer.product.title.slice(0, 60),
          precoAtual: this.brl(atual),
          referencia: this.brl(referencia),
          descontoReal: `${(desconto * 100).toFixed(1)}%`,
          exigido: `${(criterio.minRealDiscount * 100).toFixed(0)}%`,
          diasHistorico: dias,
          falta:
            gap <= 0
              ? 'passa no criterio'
              : dias <= 1
                ? 'sem serie: referencia = preco atual'
                : `faltam ${(gap * 100).toFixed(1)} pontos de desconto`,
          _gap: gap,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a._gap - b._gap)
      .slice(0, 10);

    return avaliadas.map(({ _gap, ...rest }) => rest);
  }

  private brl(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
