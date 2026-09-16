import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Constroi/atualiza agregacoes diarias (product_price_daily, secao 5) a partir
 * das observacoes brutas. Roda apos a coleta (job aggregate:daily).
 */
@Injectable()
export class PriceAggregationService {
  private readonly logger = new Logger(PriceAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Recalcula a agregacao diaria de uma oferta para o dia informado (default: hoje). */
  async aggregateDay(productOfferId: string, day: Date = new Date()): Promise<void> {
    const dayStart = startOfUtcDay(day);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const observations = await this.prisma.priceObservation.findMany({
      where: {
        productOfferId,
        observedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { observedAt: 'asc' },
    });

    if (observations.length === 0) {
      return;
    }

    const prices = observations.map((o) => o.priceCents);
    const minPriceCents = Math.min(...prices);
    const maxPriceCents = Math.max(...prices);
    const closePriceCents = observations[observations.length - 1].priceCents;
    const offer = await this.prisma.productOffer.findUniqueOrThrow({
      where: { id: productOfferId },
      select: { marketplace: true },
    });

    await this.prisma.dailyPriceAggregate.upsert({
      where: {
        productOfferId_day: { productOfferId, day: dayStart },
      },
      create: {
        productOfferId,
        source: offer.marketplace,
        day: dayStart,
        minPriceCents,
        maxPriceCents,
        closePriceCents,
        observationsCount: observations.length,
      },
      update: {
        minPriceCents,
        maxPriceCents,
        closePriceCents,
        observationsCount: observations.length,
      },
    });

    this.logger.debug(
      `Agregacao diaria atualizada para oferta ${productOfferId} (${dayStart.toISOString().slice(0, 10)})`,
    );
  }

  /**
   * Roda a agregacao do dia atual para todas as ofertas que tiveram observacao
   * hoje E registra o preco vigente das demais ofertas ativas (carry-forward).
   *
   * POR QUE O CARRY-FORWARD: PriceRecordingService so grava observacao quando
   * algo relevante muda (preco, frete, comissao, estoque). Se o preco fica
   * estavel — o caso da maioria dos produtos — nenhuma observacao nova e
   * criada, nenhum agregado diario e gerado, e a serie historica FICA PARADA
   * em 1 ponto para sempre.
   *
   * Isso travava o sistema inteiro: com 1 ponto, o preco de referencia e o
   * proprio preco atual, o desconto real da sempre 0% e nenhuma oferta pode
   * ser aprovada. O historico nunca amadurecia porque "preco estavel" era
   * lido como "sem dados" em vez de "dado: o preco continua X".
   *
   * "O preco hoje continua R$ 99,90" e um fato observado, nao uma invencao —
   * a coleta rodou e confirmou esse preco. Registrar isso e o que permite ao
   * plateau de 90 dias significar alguma coisa.
   */
  async aggregateAllForToday(): Promise<number> {
    const dayStart = startOfUtcDay(new Date());

    const offerIds = await this.prisma.priceObservation.findMany({
      where: { observedAt: { gte: dayStart } },
      distinct: ['productOfferId'],
      select: { productOfferId: true },
    });

    for (const { productOfferId } of offerIds) {
      await this.aggregateDay(productOfferId, dayStart);
    }

    const carriedForward = await this.carryForwardStablePrices(dayStart);

    return offerIds.length + carriedForward;
  }

  /**
   * Para cada oferta ativa que foi coletada hoje mas NAO gerou observacao
   * nova (preco estavel), grava o agregado do dia com o ultimo preco
   * conhecido. Nao inventa preco: reusa o ultimo valor efetivamente
   * observado, para a serie refletir "o preco se manteve".
   */
  private async carryForwardStablePrices(dayStart: Date): Promise<number> {
    const alreadyAggregated = await this.prisma.dailyPriceAggregate.findMany({
      where: { day: dayStart },
      select: { productOfferId: true },
    });
    const done = new Set(alreadyAggregated.map((a) => a.productOfferId));

    // So considera ofertas que a coleta realmente visitou hoje — sem isso
    // estariamos afirmando preco de oferta que ninguem checou.
    const collectedToday = await this.prisma.productOffer.findMany({
      where: { active: true, lastCollectedAt: { gte: dayStart } },
      select: { id: true, marketplace: true },
    });

    const pendentes = collectedToday.filter((o) => !done.has(o.id));

    if (pendentes.length === 0) {
      return 0;
    }

    // Busca o ultimo preco de TODAS as ofertas pendentes de uma vez. Uma
    // consulta por oferta (N+1) levava ~1000 idas ao banco por ciclo e
    // estourava o pool de conexoes do Supabase.
    const ultimosPrecos = await this.prisma.$queryRaw<
      { productOfferId: string; priceCents: number }[]
    >`
      SELECT DISTINCT ON ("productOfferId") "productOfferId", "priceCents"
      FROM "PriceObservation"
      WHERE "productOfferId" = ANY(${pendentes.map((o) => o.id)}::text[])
      ORDER BY "productOfferId", "observedAt" DESC
    `;

    const precoPorOferta = new Map(
      ultimosPrecos.map((r) => [r.productOfferId, r.priceCents]),
    );

    let count = 0;
    let semPrecoConhecido = 0;

    for (const offer of pendentes) {
      const preco = precoPorOferta.get(offer.id);

      // Oferta marcada como coletada mas sem nenhuma observacao de preco.
      // Acontece quando a descoberta cria a oferta (gravando lastCollectedAt)
      // sem passar pelo registro de preco. Nao da para carregar um preco que
      // nunca foi observado — mas isso precisa aparecer no log, nao sumir.
      if (preco == null) {
        semPrecoConhecido++;
        continue;
      }

      await this.prisma.dailyPriceAggregate.upsert({
        where: { productOfferId_day: { productOfferId: offer.id, day: dayStart } },
        create: {
          productOfferId: offer.id,
          source: offer.marketplace,
          day: dayStart,
          minPriceCents: preco,
          maxPriceCents: preco,
          closePriceCents: preco,
          observationsCount: 0, // 0 = dia sem observacao nova, preco carregado
        },
        update: {},
      });

      count++;
    }

    if (semPrecoConhecido > 0) {
      this.logger.warn(
        `${semPrecoConhecido} ofertas foram marcadas como coletadas mas nunca tiveram ` +
          'preco observado — ficam de fora do historico ate a proxima coleta registrar um preco.',
      );
    }

    if (count > 0) {
      this.logger.log(`Carry-forward: ${count} ofertas com preco estavel registradas hoje.`);
    }

    return count;
  }
}
