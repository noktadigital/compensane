# Achadinhos

Sistema interno de inteligência de ofertas para afiliados — um "copiloto de ofertas". Monitora marketplaces (Shopee e Mercado Livre), detecta quedas de preço reais (não anúncios enganosos), calcula um **Deal Score**, e envia as melhores oportunidades para aprovação via **Discord**. Após aprovação, gera o post pronto e o link para compartilhamento manual no **WhatsApp**.

## Filosofia

O sistema não tenta encontrar todas as ofertas — ele busca **as melhores**. É preferível 10 ofertas excelentes a 500 ofertas ruins. O diferencial central é o histórico de preço: nunca confiamos apenas em "50% OFF" anunciado pelo vendedor, sempre validamos contra o preço de referência real calculado a partir do histórico observado.

## Arquitetura

```
Marketplace APIs (Shopee, Mercado Livre)
        ↓
   Collectors (jobs BullMQ)
        ↓
     Normalizer (ProductsService)
        ↓
      Database (PostgreSQL + Prisma)
        ↓
   Price History (agregação diária, plateau, confiança)
        ↓
   Analysis Engine (Deal Score, Pre-Hike Detector, EV)
        ↓
      Discord Bot (aprovação humana)
        ↓
    Affiliate Link + Post Template
        ↓
   WhatsApp share (deep link, envio manual)
```

O core nunca conhece detalhes de um marketplace específico — tudo passa pela interface `MarketplaceAdapter` (`src/marketplaces/core`). Shopee e Mercado Livre já estão implementados nesse padrão; TikTok Shop e Amazon serão adicionados futuramente.

## Stack

- **Backend**: NestJS + TypeScript (CommonJS, Node 18+)
- **ORM**: Prisma
- **Banco**: PostgreSQL
- **Fila/Jobs**: BullMQ + Redis
- **Bot**: Discord (`discord.js`)
- **Logs**: Winston (estruturado, `nest-winston`)
- **Testes**: Jest

## Pré-requisitos

- Node.js 18+
- Docker (para Postgres/Redis locais) ou instâncias próprias
- Um bot no Discord ([Developer Portal](https://discord.com/developers/applications)) e um servidor onde convidá-lo

## Setup local

```bash
# 1. Instalar dependências
npm install

# 2. Subir Postgres e Redis via Docker
docker compose up -d

# 3. Configurar variáveis de ambiente
cp .env.example .env
# edite .env: DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID (obrigatórios para receber ofertas)

# 4. Rodar migrations
npm run prisma:migrate

# 5. (Opcional) popular keywords de descoberta iniciais
npm run seed

# 6. Rodar em modo desenvolvimento
npm run start:dev
```

Sem `SHOPEE_APP_ID`/`SHOPEE_APP_SECRET` configurados (ou com `SHOPEE_MODE=mock`), o sistema roda inteiramente com o **ShopeeMockAdapter** — um catálogo simulado com cenários de desconto real, falso desconto (pre-hike), pouco histórico, etc. Isso permite testar o pipeline completo (coleta → histórico → Deal Score → Discord → aprovação → link → WhatsApp) sem credenciais reais.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As mais importantes:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do PostgreSQL |
| `REDIS_URL` | Connection string do Redis (BullMQ) |
| `DISCORD_BOT_TOKEN` | Token do bot (Developer Portal → aba Bot → Reset Token) |
| `DISCORD_CHANNEL_ID` | ID do canal que recebe os cards de oferta |
| `SHOPEE_MODE` | `mock` (padrão, sem credenciais) ou `live` |
| `SHOPEE_APP_ID` / `SHOPEE_APP_SECRET` | Credenciais da Shopee Affiliate Open API |
| `MIN_REAL_DISCOUNT` | Desconto real mínimo para considerar a oferta (padrão 0.10) |
| `PUBLISH_SCORE` | Deal Score mínimo para enviar ao Discord (padrão 70) |
| `HIGH_SCORE` | Score considerado prioridade alta (padrão 85) |
| `AUTO_APPROVE_SCORE` | Reservado para auto-aprovação futura (NUNCA usado na V1) |

### Como configurar o bot do Discord

1. Em [discord.com/developers/applications](https://discord.com/developers/applications): **New Application** → aba **Bot** → **Reset Token** → copie para `DISCORD_BOT_TOKEN`.
2. Ainda na aba Bot, deixe todos os **Privileged Gateway Intents** desligados — nenhum é necessário. O bot só envia embeds e escuta cliques em botão (Interaction), o que não exige intent privilegiada.
3. Aba **OAuth2 → URL Generator**: marque o scope `bot` e as permissões **Send Messages**, **Embed Links** e **Read Message History**. Abra a URL gerada e escolha o servidor.
4. No Discord: **Configurações do Usuário → Avançado → Modo Desenvolvedor**. Depois, botão direito no canal → **Copiar ID do canal** → `DISCORD_CHANNEL_ID`.

**Atenção**: o botão direito no *nome do servidor* copia o ID da guild, não do canal. Usar o ID errado faz o envio falhar com `DiscordAPIError[10003]: Unknown Channel`. Rode `scripts/dev/diagnose-discord.ts` para listar os canais visíveis ao bot com seus IDs e permissões.

## Estrutura de módulos

```
src/
├── config/            # Configuração central + validação de env (class-validator)
├── common/logger/      # Logger estruturado (Winston)
├── database/           # PrismaService (global)
├── marketplaces/
│   ├── core/            # MarketplaceAdapter (interface) + registry
│   └── shopee/           # ShopeeMockAdapter, ShopeeLiveAdapter, assinatura HMAC
├── dedup/               # DeduplicationService (GTIN / título normalizado)
├── products/            # Normalizer: upsert de Product + ProductOffer
├── price-history/       # Recording, agregação diária, estatísticas, plateau, confiança
├── deals/               # DealScoringService, PreHikeDetector, EvScoringService, DealsService
├── posts/               # PostTemplateService (card de aprovação + texto WhatsApp)
├── tracking/            # DealDecision, Click, métricas básicas
├── discord/             # Bot: embeds, botões aprovar/rejeitar
├── jobs/                # Filas e processors BullMQ (collect, record, aggregate, analyze, notify, cleanup)
├── redirect/             # Redirecionador /r/{slug} com tracking de clique
└── health/               # /health e /metrics
```

## Pipeline de jobs

| Fila (nome BullMQ) | Responsabilidade |
|---|---|
| `collect-shopee` | Busca estado atual das ofertas conhecidas por tier (HOT/WARM/COLD) |
| `discover-shopee` | Descobre novos produtos via `SearchKeyword` |
| `record-prices` | Grava observação de preço (só se algo relevante mudou) |
| `aggregate-daily` | Consolida observações do dia em `DailyPriceAggregate` |
| `analyze-deals` | Roda o Analysis Engine e cria um `Deal` quando aplicável |
| `notify-discord` | Envia o card da oferta para aprovação |
| `cleanup-data` | Expira deals antigos sem decisão |

(Nomes de fila usam `-` em vez de `:` por restrição do BullMQ/Redis; conceitualmente correspondem a `collect:shopee` etc. do briefing original.)

Os intervalos de cada tier de polling (`POLLING_HOT_INTERVAL_MIN` etc.) são configuráveis via `.env` — nunca hardcoded.

## Scripts de desenvolvimento/debug

`scripts/dev/` contém utilitários fora do pipeline de produção, úteis para testar o sistema manualmente:

- `backfill-demo-history.ts` — popula 90 dias de histórico simulado (plateau em torno de R$199) para a oferta mock `mock-whey-dark-lab-1`, permitindo testar o Deal Score com confiança alta sem esperar dias reais de coleta.
- `trigger-analyze.ts` — dispara a análise de deal manualmente para essa oferta e envia o card ao Discord, sem esperar o próximo ciclo do scheduler.
- `inspect-offer.ts` — mostra o estado atual (últimas observações, contagem de agregações) de uma oferta no banco.
- `test-discord.ts` — envia dois cards de teste ao canal (uma oferta honesta e uma com desconto inflado), validando token, permissões e a renderização do embed.
- `diagnose-discord.ts` — lista os servidores e canais que o bot enxerga, com IDs e permissões. Use quando o envio falhar com `Unknown Channel`.
- `test-shopee-adapter.ts` — exercita o `ShopeeLiveAdapter` contra a API real (busca, polling por id, geração de link com subId).

Rode com `npx ts-node -r tsconfig-paths/register scripts/dev/<script>.ts`. **Importante**: pare a aplicação principal (`npm run start:dev`/`start:prod`) antes de rodar esses scripts — o Supabase Session Pooler (plano free) tem um limite baixo de conexões simultâneas (15), e rodar múltiplos processos Prisma ao mesmo tempo pode esgotar o pool (erro `EMAXCONNSESSION`).

## Notas de infraestrutura (Supabase + Upstash)

- **Supabase — use o Session Pooler, não a Direct Connection.** A conexão direta (`db.xxx.supabase.co:5432`) resolve apenas em IPv6, o que falha em várias redes no Brasil. Use `Project Settings → Database → Connection String → Session pooler` (host `aws-0-<região>.pooler.supabase.com`, porta 5432).
- **Sempre defina `connection_limit` na `DATABASE_URL`** (ex: `?connection_limit=5&pool_timeout=10`) — o Session Pooler do plano free tem um teto de 15 conexões simultâneas, e o Prisma abre várias conexões por instância se não for limitado.
- **RLS (Row Level Security) desabilitado é esperado** e aparece como "erro" no Security Advisor do Supabase — mas só importa quando o banco é acessado via API pública (`supabase-js`/PostgREST) por clientes não confiáveis. Aqui o Postgres só é acessado pelo backend NestJS via Prisma com credenciais de admin, então RLS é opcional (cosmético).
- **Projetos Supabase free pausam automaticamente após ~7 dias de inatividade.** O sintoma é confuso: comandos Prisma locais falham com `FATAL: (ENOTFOUND) tenant/user <ref> not found` e a app em produção retorna 502 — parece problema de credenciais, mas é só o projeto dormindo. Não há como acordar via tentativa de conexão; entre em supabase.com/dashboard e clique em "Restore"/"Resume".

## Mercado Livre — autenticação OAuth2 + PKCE

Diferente da Shopee (App ID/Secret direto), a API do Mercado Livre exige OAuth2 com PKCE. Passos para autorizar:

1. Crie um app em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br) → "Gestão de aplicações". Anote o **Client ID** e a **Chave secreta** (Client Secret).
2. Configure o **Redirect URI** do app para `<APP_URL>/marketplaces/mercado-livre/callback` (precisa bater exatamente).
3. Preencha `MERCADO_LIVRE_CLIENT_ID`, `MERCADO_LIVRE_CLIENT_SECRET` e `MERCADO_LIVRE_REDIRECT_URI` no `.env`, e defina `MERCADO_LIVRE_MODE=live`.
4. Com a aplicação rodando, acesse `GET <APP_URL>/marketplaces/mercado-livre/auth` no navegador uma única vez — isso redireciona para o login do ML, e após autorizar, o ML chama o callback automaticamente, trocando o código por `access_token`/`refresh_token` (persistidos em `MarketplaceOAuthToken`).
5. Confira em `GET <APP_URL>/marketplaces/mercado-livre/status` se `authorized: true`.

**O `access_token` expira em 6 horas e o `refresh_token` do ML é de uso único** — a cada renovação automática, o token novo substitui o anterior no banco (`MercadoLivreOAuthService.getValidAccessToken` cuida disso sozinho, com margem de segurança de 5 minutos antes do vencimento).

### Limitações conhecidas da API do Mercado Livre

- **Não existe API oficial para gerar link de afiliado.** O link é a URL do produto com os parâmetros `matt_word` e `matt_tool` (fixos por conta de afiliado) anexados — obtidos manualmente clicando em "Compartilhar" no [Portal de Afiliados](https://mercadolivre.com.br) → Afiliados e criadores → Central. Configure `MERCADO_LIVRE_MATT_WORD`/`MERCADO_LIVRE_MATT_TOOL` no `.env`.
- **O endpoint de busca pública (`/sites/{site}/search`) tem retornado 403 Forbidden** mesmo para aplicações com OAuth válido, segundo relatos de múltiplos desenvolvedores (sem comunicação oficial clara do motivo — pode exigir programa de parceiros). Se a descoberta por keyword falhar consistentemente, isso é esperado; `getOffersByIds` (via `/items?ids=...`) usa outro endpoint e tende a funcionar normalmente.

## Deal Score

Módulo isolado (`DealScoringService`), soma de 6 componentes (0–100):

- **S_desconto** (0–40): desconto real vs. preço de referência (plateau)
- **S_minimo** (0–20): proximidade do menor preço em 90 dias
- **S_comissao** (0–15): comissão em R$ (não em %)
- **S_atrito** (0–10): frete grátis + cupom + estoque
- **S_estabilidade** (0–10): baixa volatilidade do histórico
- **S_demanda** (0–5): rating + volume de vendas

O score bruto é multiplicado pelo `confidence_score` (0–1), que reflete o quanto o histórico disponível sustenta a decisão (cold start: 14 dias = confiança inicial, 90 dias = confiança alta).

## Detecção de aumento artificial (pre-hike)

O `PreHikeDetector` procura, nos últimos 14 dias, um pico de preço relevante (≥15% acima do preço de referência) seguido de retorno ao preço normal. Quando esse padrão aparece, a "promoção" é descartada — não é publicada mesmo que pareça um desconto grande.

### Desconto anunciado vs. desconto real

Os dois números são gravados e **confrontados**, nunca confundidos:

- **Anunciado** — vem do marketplace (ex: `priceDiscountRate` da Shopee) e é persistido em `PriceObservation.discountRate`. Serve apenas como evidência; nunca entra no Deal Score.
- **Real** — calculado contra o preço de referência do nosso próprio histórico (`PriceReferenceService`), e é o único que decide publicação.

Quando o anunciado supera o real em 15 pontos percentuais ou mais, o card de aprovação ganha borda laranja e um campo **⚠️ DESCONTO INFLADO** mostrando os dois lado a lado. O post de WhatsApp sempre risca o preço de *referência*, nunca o "de/por" da loja.

## Anti-repetição de alertas

Uma oferta que passa dias em promoção não pode virar um card a cada ciclo de polling (o tier HOT roda a cada 15 min). `DealsService` aplica uma janela de silêncio de **72 horas** por oferta: dentro dela, a mesma oferta só volta a alertar se o preço cair **abaixo** do que já foi alertado.

## Testes

```bash
npm test
```

Cobertura principal: `DealScoringService`, `PreHikeDetector`, `PriceReferenceService`, `ConfidenceScoreService`, `DeduplicationService`, `PostTemplateService`.

## Roadmap

- **V1** (atual): Shopee + histórico + Deal Score + Discord + WhatsApp manual
- **V2**: TikTok Shop, Mercado Livre, Amazon
- **V3**: Dashboard, analytics, aprendizado de conversão
- **V4**: SaaS multiusuário

## Segurança

- Nunca commitar `.env`
- Credenciais sempre via variáveis de ambiente
- `.env.example` documenta todas as variáveis necessárias, sem valores reais
