# Achadinhos

Sistema interno de inteligência de ofertas para afiliados — um "copiloto de ofertas". Monitora marketplaces (V1: Shopee), detecta quedas de preço reais (não anúncios enganosos), calcula um **Deal Score**, e envia as melhores oportunidades para aprovação via **Telegram**. Após aprovação, gera o post pronto e o link para compartilhamento manual no **WhatsApp**.

## Filosofia

O sistema não tenta encontrar todas as ofertas — ele busca **as melhores**. É preferível 10 ofertas excelentes a 500 ofertas ruins. O diferencial central é o histórico de preço: nunca confiamos apenas em "50% OFF" anunciado pelo vendedor, sempre validamos contra o preço de referência real calculado a partir do histórico observado.

## Arquitetura

```
Marketplace APIs (Shopee)
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
      Telegram Bot (aprovação humana)
        ↓
    Affiliate Link + Post Template
        ↓
   WhatsApp share (deep link, envio manual)
```

O core nunca conhece detalhes de um marketplace específico — tudo passa pela interface `MarketplaceAdapter` (`src/marketplaces/core`). A Shopee é a primeira implementação; TikTok Shop, Amazon e Mercado Livre serão adicionados no mesmo padrão futuramente.

## Stack

- **Backend**: NestJS + TypeScript (CommonJS, Node 18+)
- **ORM**: Prisma
- **Banco**: PostgreSQL
- **Fila/Jobs**: BullMQ + Redis
- **Bot**: Telegram (`telegraf` via `nestjs-telegraf`)
- **Logs**: Winston (estruturado, `nest-winston`)
- **Testes**: Jest

## Pré-requisitos

- Node.js 18+
- Docker (para Postgres/Redis locais) ou instâncias próprias
- Uma conta de bot no Telegram ([@BotFather](https://t.me/BotFather))

## Setup local

```bash
# 1. Instalar dependências
npm install

# 2. Subir Postgres e Redis via Docker
docker compose up -d

# 3. Configurar variáveis de ambiente
cp .env.example .env
# edite .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID (obrigatórios para receber ofertas)

# 4. Rodar migrations
npm run prisma:migrate

# 5. (Opcional) popular keywords de descoberta iniciais
npm run seed

# 6. Rodar em modo desenvolvimento
npm run start:dev
```

Sem `SHOPEE_APP_ID`/`SHOPEE_APP_SECRET` configurados (ou com `SHOPEE_MODE=mock`), o sistema roda inteiramente com o **ShopeeMockAdapter** — um catálogo simulado com cenários de desconto real, falso desconto (pre-hike), pouco histórico, etc. Isso permite testar o pipeline completo (coleta → histórico → Deal Score → Telegram → aprovação → link → WhatsApp) sem credenciais reais.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As mais importantes:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do PostgreSQL |
| `REDIS_URL` | Connection string do Redis (BullMQ) |
| `TELEGRAM_BOT_TOKEN` | Token do bot (via @BotFather) |
| `TELEGRAM_ADMIN_CHAT_ID` | Chat ID que recebe os cards de oferta |
| `SHOPEE_MODE` | `mock` (padrão, sem credenciais) ou `live` |
| `SHOPEE_APP_ID` / `SHOPEE_APP_SECRET` | Credenciais da Shopee Affiliate Open API |
| `MIN_REAL_DISCOUNT` | Desconto real mínimo para considerar a oferta (padrão 0.10) |
| `PUBLISH_SCORE` | Deal Score mínimo para publicar no Telegram (padrão 70) |
| `HIGH_SCORE` | Score considerado prioridade alta (padrão 85) |
| `AUTO_APPROVE_SCORE` | Reservado para auto-aprovação futura (NUNCA usado na V1) |

### Como obter o `TELEGRAM_ADMIN_CHAT_ID`

1. Crie o bot com [@BotFather](https://t.me/BotFather) e copie o token para `TELEGRAM_BOT_TOKEN`.
2. Envie uma mensagem qualquer para o bot.
3. Acesse `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o `chat.id` retornado.

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
├── posts/               # PostTemplateService (Telegram card + texto WhatsApp)
├── tracking/            # DealDecision, Click, métricas básicas
├── telegram/            # Bot: cards, botões aprovar/rejeitar, comando /status
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
| `notify-telegram` | Envia o card da oferta para aprovação |
| `cleanup-data` | Expira deals antigos sem decisão |

(Nomes de fila usam `-` em vez de `:` por restrição do BullMQ/Redis; conceitualmente correspondem a `collect:shopee` etc. do briefing original.)

Os intervalos de cada tier de polling (`POLLING_HOT_INTERVAL_MIN` etc.) são configuráveis via `.env` — nunca hardcoded.

## Scripts de desenvolvimento/debug

`scripts/dev/` contém utilitários fora do pipeline de produção, úteis para testar o sistema manualmente:

- `backfill-demo-history.ts` — popula 90 dias de histórico simulado (plateau em torno de R$199) para a oferta mock `mock-whey-dark-lab-1`, permitindo testar o Deal Score com confiança alta sem esperar dias reais de coleta.
- `trigger-analyze.ts` — dispara a análise de deal manualmente para essa oferta e envia o card ao Telegram, sem esperar o próximo ciclo do scheduler.
- `inspect-offer.ts` — mostra o estado atual (últimas observações, contagem de agregações) de uma oferta no banco.

Rode com `npx ts-node -r tsconfig-paths/register scripts/dev/<script>.ts`. **Importante**: pare a aplicação principal (`npm run start:dev`/`start:prod`) antes de rodar esses scripts — o Supabase Session Pooler (plano free) tem um limite baixo de conexões simultâneas (15), e rodar múltiplos processos Prisma ao mesmo tempo pode esgotar o pool (erro `EMAXCONNSESSION`).

## Notas de infraestrutura (Supabase + Upstash)

- **Supabase — use o Session Pooler, não a Direct Connection.** A conexão direta (`db.xxx.supabase.co:5432`) resolve apenas em IPv6, o que falha em várias redes no Brasil. Use `Project Settings → Database → Connection String → Session pooler` (host `aws-0-<região>.pooler.supabase.com`, porta 5432).
- **Sempre defina `connection_limit` na `DATABASE_URL`** (ex: `?connection_limit=5&pool_timeout=10`) — o Session Pooler do plano free tem um teto de 15 conexões simultâneas, e o Prisma abre várias conexões por instância se não for limitado.
- **RLS (Row Level Security) desabilitado é esperado** e aparece como "erro" no Security Advisor do Supabase — mas só importa quando o banco é acessado via API pública (`supabase-js`/PostgREST) por clientes não confiáveis. Aqui o Postgres só é acessado pelo backend NestJS via Prisma com credenciais de admin, então RLS é opcional (cosmético).

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

## Testes

```bash
npm test
```

Cobertura principal: `DealScoringService`, `PreHikeDetector`, `PriceReferenceService`, `ConfidenceScoreService`, `DeduplicationService`, `PostTemplateService`.

## Roadmap

- **V1** (atual): Shopee + histórico + Deal Score + Telegram + WhatsApp manual
- **V2**: TikTok Shop, Mercado Livre, Amazon
- **V3**: Dashboard, analytics, aprendizado de conversão
- **V4**: SaaS multiusuário

## Segurança

- Nunca commitar `.env`
- Credenciais sempre via variáveis de ambiente
- `.env.example` documenta todas as variáveis necessárias, sem valores reais
