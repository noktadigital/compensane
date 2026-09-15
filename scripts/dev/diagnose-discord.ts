/**
 * Diagnostico de acesso do bot ao Discord. Responde por que um canal da
 * "Unknown Channel": bot nao entrou no servidor, ID errado, ou canal sem
 * permissao de visualizacao para o bot.
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/dev/diagnose-discord.ts
 */
import { config } from 'dotenv';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

config();

const TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID ?? '';

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await new Promise<void>((resolve, reject) => {
    client.once('clientReady', () => resolve());
    client.once('error', reject);
    client.login(TOKEN).catch(reject);
    setTimeout(() => reject(new Error('Timeout de 30s')), 30_000);
  });

  console.log(`Bot: ${client.user?.tag} (id ${client.user?.id})`);

  // 1. Em quais servidores o bot esta?
  const guilds = [...client.guilds.cache.values()];
  console.log(`\nServidores em que o bot esta: ${guilds.length}`);

  if (guilds.length === 0) {
    console.log('  NENHUM — o bot nunca foi convidado para um servidor.');
    console.log('  Gere a URL em OAuth2 > URL Generator (scope "bot") e abra no navegador.');
    await client.destroy();
    process.exit(0);
  }

  // 2. Quais canais de texto o bot enxerga em cada servidor?
  for (const guild of guilds) {
    console.log(`\n  ${guild.name} (id ${guild.id})`);

    const channels = await guild.channels.fetch();
    const textChannels = [...channels.values()].filter(
      (c): c is NonNullable<typeof c> => c != null && c.type === ChannelType.GuildText,
    );

    if (textChannels.length === 0) {
      console.log('    (nenhum canal de texto visivel para o bot)');
      continue;
    }

    const me = guild.members.me;
    for (const channel of textChannels) {
      const perms = me ? channel.permissionsFor(me) : null;
      const canView = perms?.has('ViewChannel') ?? false;
      const canSend = perms?.has('SendMessages') ?? false;
      const canEmbed = perms?.has('EmbedLinks') ?? false;
      const marker = channel.id === CHANNEL_ID ? '  <<< ID DO .env' : '';

      console.log(
        `    #${channel.name}  id=${channel.id}  ` +
          `[ver=${canView ? 'ok' : 'NAO'} enviar=${canSend ? 'ok' : 'NAO'} embed=${canEmbed ? 'ok' : 'NAO'}]${marker}`,
      );
    }
  }

  // 3. O ID configurado resolve?
  console.log(`\nID configurado no .env: ${CHANNEL_ID}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    console.log(`  Resolveu: ${channel ? `#${'name' in channel ? channel.name : channel.id}` : 'null'}`);
  } catch (err) {
    console.log(`  NAO resolveu: ${(err as Error).message}`);
    console.log('  Causa: o ID nao existe, ou pertence a um servidor onde o bot nao esta.');
  }

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});
