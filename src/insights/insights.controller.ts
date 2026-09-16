import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { DiagnosticsService } from './diagnostics.service';
import { PriceHistoryQuery } from './price-history.query';

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Visibilidade do pipeline. Ate aqui os dados coletados so podiam ser lidos
 * via SQL direto no banco — o sistema podia estar coletando corretamente e
 * mesmo assim nao gerar nenhum card, sem nenhuma forma de distinguir isso de
 * estar quebrado.
 */
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly diagnostics: DiagnosticsService,
    private readonly history: PriceHistoryQuery,
  ) {}

  /** JSON cru: responde "esta funcionando?" em uma chamada. */
  @Get('diagnostico')
  async diagnostico() {
    return this.diagnostics.getPipelineDiagnostics();
  }

  @Get('ofertas')
  async ofertas() {
    return this.history.listOffers();
  }

  /** Tudo que ja foi aprovado e foi para o grupo — evita repetir post. */
  @Get('publicados')
  async publicados() {
    return this.history.listPublished();
  }

  @Get('ofertas/:id')
  async oferta(@Param('id') id: string) {
    const historico = await this.history.getOfferHistory(id);
    if (!historico) {
      throw new NotFoundException('Oferta nao encontrada');
    }
    return historico;
  }

  /** Painel HTML — a mesma informacao, legivel sem ferramenta. */
  @Get()
  async painel(@Res() res: Response) {
    const [diag, ofertas, publicados] = await Promise.all([
      this.diagnostics.getPipelineDiagnostics(),
      this.history.listOffers(50),
      this.history.listPublished(50),
    ]);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(this.renderPainel(diag, ofertas, publicados));
  }

  private renderPainel(
    diag: Awaited<ReturnType<DiagnosticsService['getPipelineDiagnostics']>>,
    ofertas: Awaited<ReturnType<PriceHistoryQuery['listOffers']>>,
    publicados: Awaited<ReturnType<PriceHistoryQuery['listPublished']>>,
  ): string {
    const ultimaColeta = diag.coleta.ultimaColeta
      ? new Date(diag.coleta.ultimaColeta).toLocaleString('pt-BR')
      : 'nunca';

    const linhasQuaseLa = diag.quaseLa
      .map(
        (o) => `<tr>
          <td>${escapeHtml(o.produto)}</td>
          <td class="num">${o.precoAtual}</td>
          <td class="num">${o.referencia}</td>
          <td class="num">${o.descontoReal} / ${o.exigido}</td>
          <td class="num">${o.diasHistorico}d</td>
          <td class="${o.falta === 'passa no criterio' ? 'ok' : 'muted'}">${escapeHtml(o.falta)}</td>
        </tr>`,
      )
      .join('');

    const linhasOfertas = ofertas
      .map((o) => {
        const enviado = o.jaEnviado
          ? `<span class="tag" title="${o.enviadoEm ? new Date(o.enviadoEm).toLocaleString('pt-BR') : ''}">✓ enviado</span>`
          : '<span class="muted">—</span>';

        // O titulo abre a pagina real do produto no marketplace (nova aba);
        // o historico fica num link separado, para as duas coisas nao
        // competirem pelo mesmo clique.
        return `<tr>
          <td>
            <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.titulo.slice(0, 70))}</a>
            <a class="hist" href="/insights/ofertas/${o.id}" title="ver série de preços">histórico</a>
          </td>
          <td class="num">${brl(o.precoAtualCents)}</td>
          <td class="num">${brl(o.minimoCents)}</td>
          <td class="num">${brl(o.maximoCents)}</td>
          <td class="num">${o.diasHistorico}d</td>
          <td class="num ${o.descontoReal > 0 ? 'ok' : 'muted'}">${(o.descontoReal * 100).toFixed(1)}%</td>
          <td>${enviado}</td>
        </tr>`;
      })
      .join('');

    const linhasPublicados = publicados
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.titulo.slice(0, 65))}</td>
          <td class="num">${brl(p.precoCents)}</td>
          <td class="num">${p.diasAtras === 0 ? 'hoje' : `${p.diasAtras}d atrás`}</td>
          <td class="num">${p.cliques}</td>
          <td>${p.link ? `<a href="${escapeHtml(p.link)}">abrir</a>` : '<span class="muted">sem link</span>'}</td>
        </tr>`,
      )
      .join('');

    const distribuicao = diag.historico.distribuicaoDias
      .map((d) => `${d.dias}d: ${d.ofertas}`)
      .join(' &middot; ');

    return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Achadinhos — pipeline</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;max-width:1100px}
h1{font-size:18px;margin:0 0 4px}
h2{font-size:14px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em;opacity:.6}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
.card{border:1px solid #8883;border-radius:8px;padding:12px 16px;min-width:130px}
.card .v{font-size:22px;font-weight:600}
.card .l{font-size:12px;opacity:.6}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #8882}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.55}
.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:#16a34a}.muted{opacity:.55}
.alerta{border:1px solid #f59e0b55;background:#f59e0b12;border-radius:8px;padding:12px 16px;margin-top:16px}
.tag{font-size:11px;padding:2px 7px;border-radius:99px;background:#16a34a22;color:#16a34a;white-space:nowrap}
.hist{font-size:11px;opacity:.45;margin-left:8px;text-decoration:none;white-space:nowrap}
.hist:hover{opacity:.9;text-decoration:underline}
a{color:inherit}
</style></head><body>
<h1>Pipeline Achadinhos</h1>
<div class="muted">Última coleta: ${ultimaColeta}</div>

<div class="cards">
  <div class="card"><div class="v">${diag.coleta.ofertasAtivas}</div><div class="l">ofertas ativas</div></div>
  <div class="card"><div class="v">${diag.coleta.observacoesTotais}</div><div class="l">observações</div></div>
  <div class="card"><div class="v">${diag.coleta.diasAgregados}</div><div class="l">dias agregados</div></div>
  <div class="card"><div class="v">${diag.deals.detectados}</div><div class="l">deals pendentes</div></div>
  <div class="card"><div class="v">${diag.deals.publicados}</div><div class="l">publicados</div></div>
</div>

${
  diag.coleta.ofertasSemHistorico > 0
    ? `<div class="alerta"><strong>${diag.coleta.ofertasSemHistorico} ofertas sem nenhum dia de histórico.</strong>
       Foram descobertas mas ainda não observadas — a coleta cobre ${'~120'} por ciclo, em rodízio.</div>`
    : ''
}

<h2>Maturidade do histórico</h2>
<div>${escapeHtml(diag.historico.fasePredominante)}</div>
<div class="muted" style="margin-top:6px">Distribuição: ${distribuicao || 'sem dados'}</div>

<h2>Mais perto de virar oferta</h2>
<table><thead><tr>
<th>Produto</th><th class="num">Atual</th><th class="num">Referência</th>
<th class="num">Real / Exigido</th><th class="num">Histórico</th><th>Falta</th>
</tr></thead><tbody>${linhasQuaseLa || '<tr><td colspan="6" class="muted">sem dados</td></tr>'}</tbody></table>

<h2>Já enviados ao grupo (${publicados.length})</h2>
<table><thead><tr>
<th>Produto</th><th class="num">Preço</th><th class="num">Quando</th>
<th class="num">Cliques</th><th>Link</th>
</tr></thead><tbody>${linhasPublicados || '<tr><td colspan="5" class="muted">nada publicado ainda</td></tr>'}</tbody></table>

<h2>Ofertas monitoradas</h2>
<table><thead><tr>
<th>Produto</th><th class="num">Atual</th><th class="num">Mín</th>
<th class="num">Máx</th><th class="num">Histórico</th><th class="num">Desconto</th><th>Enviado?</th>
</tr></thead><tbody>${linhasOfertas || '<tr><td colspan="7" class="muted">sem dados</td></tr>'}</tbody></table>
</body></html>`;
  }
}
