/**
 * Teste isolado da integracao com o Discord. Nao sobe o app Nest nem toca o
 * banco (nao consome conexao do pool do Supabase).
 *
 * Valida de ponta a ponta: token, acesso ao canal, permissoes de envio e a
 * renderizacao do embed — incluindo o alerta de desconto inflado, que e o
 * diferencial do sistema.
 *
 * Envia DOIS cards ao canal para comparacao visual:
 *   1. Oferta honesta   — borda verde, sem alerta.
 *   2. Desconto inflado — borda laranja, com o confronto anunciado vs. real.
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/dev/test-discord.ts
 */
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../src/config/app-config.service';
import { DealEmbedBuilder } from '../../src/discord/deal-embed.builder';
import { DiscordClientService } from '../../src/discord/discord-client.service';

config();

async function main() {
  const appConfig = new AppConfigService(new ConfigService(process.env));
  const { botToken, channelId } = appConfig.discord;

  if (!botToken || !channelId) {
    console.error('DISCORD_BOT_TOKEN ou DISCORD_CHANNEL_ID ausentes no .env');
    process.exit(1);
  }

  console.log(`Canal alvo: ${channelId}`);

  const client = new DiscordClientService(appConfig, new DealEmbedBuilder());

  // Espera o gateway ficar pronto antes de tentar enviar.
  const ready = new Promise<void>((resolve, reject) => {
    client.client.once('clientReady', () => resolve());
    setTimeout(() => reject(new Error('Timeout de 30s esperando o Discord conectar.')), 30_000);
  });

  client.onApplicationBootstrap();
  await ready;
  console.log(`Conectado como ${client.client.user?.tag}`);

  // --- 1. Oferta honesta: o que a loja anuncia bate com o nosso historico ---
  await client.sendDealCard(
    'teste-oferta-honesta',
    {
      title: '[TESTE] Fone Bluetooth TWS Pro 3 com Estojo Carregador',
      priceCents: 7000,
      discountRate: 0.32,
      advertisedDiscountRate: 0.35,
      freeShipping: true,
      link: 'https://shopee.com.br/product/933390061/58202047038',
      ratingStar: 4.7,
      dealScore: 88,
      minPrice90dCents: 6890,
      commissionCents: 2310,
    },
    null,
  );
  console.log('Card 1 (oferta honesta) — envio solicitado.');

  // --- 2. Desconto inflado: loja anuncia 48%, historico diz 9% ---
  await client.sendDealCard(
    'teste-desconto-inflado',
    {
      title: '[TESTE] Fone de Ouvido Bluetooth com Cancelamento de Ruido',
      priceCents: 2299,
      discountRate: 0.09,
      advertisedDiscountRate: 0.48,
      freeShipping: false,
      link: 'https://shopee.com.br/product/933390061/58208551350',
      ratingStar: 4.2,
      dealScore: 71,
      minPrice90dCents: 2190,
      commissionCents: 758,
    },
    null,
  );
  console.log('Card 2 (desconto inflado) — envio solicitado.');

  // sendDealCard loga e engole erros de proposito (uma falha de notificacao
  // nunca deve derrubar o job), entao as linhas acima nao provam entrega.
  // Se apareceu ERROR no log, o card NAO chegou.
  console.log('\nSe nao houver ERROR acima, confira os dois cards no canal do Discord.');
  console.log('Os botoes ainda NAO respondem: quem escuta cliques e o app principal.');

  await client.onApplicationShutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFalhou:', err);
  process.exit(1);
});
