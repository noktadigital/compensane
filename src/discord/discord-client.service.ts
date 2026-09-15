import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { AppConfigService } from '@/config/app-config.service';
import { DealCardData } from '@/posts/post-template.service';
import { DealEmbedBuilder } from './deal-embed.builder';

/**
 * Conexao com o Discord e envio de cards de aprovacao.
 *
 * O login e feito manualmente no bootstrap, com retry e SEM derrubar a
 * aplicacao em caso de falha — mesma licao aprendida com o Telegram, onde
 * uma falha de rede no launch() virava unhandled rejection e matava o
 * processo inteiro, mesmo com API/jobs/banco saudaveis.
 *
 * Intents: apenas Guilds. Cliques em botao chegam como Interaction, que NAO
 * exige intent privilegiada — nao precisamos ler conteudo de mensagem.
 */
@Injectable()
export class DiscordClientService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordClientService.name);
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MS = 5000;

  readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private ready = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly embedBuilder: DealEmbedBuilder,
  ) {}

  onApplicationBootstrap() {
    const { botToken } = this.appConfig.discord;

    if (!botToken) {
      this.logger.warn('DISCORD_BOT_TOKEN nao configurado — bot nao sera conectado.');
      return;
    }

    this.client.once('clientReady', () => {
      this.ready = true;
      this.logger.log(`Bot do Discord conectado como ${this.client.user?.tag}`);
    });

    // Sem isso, um erro de socket do discord.js sobe como unhandled rejection.
    this.client.on('error', (error) => {
      this.logger.error(`Erro no cliente do Discord: ${error.message}`);
    });

    // Nao bloqueia o boot esperando o Discord responder.
    this.loginWithRetry(botToken, 1).catch((error) => {
      this.logger.error(
        `Nao foi possivel conectar ao Discord apos ${this.MAX_RETRIES} tentativas. ` +
          'O bot ficara offline; o resto do sistema continua rodando.',
        error as Error,
      );
    });
  }

  private async loginWithRetry(token: string, attempt: number): Promise<void> {
    try {
      await this.client.login(token);
    } catch (error) {
      if (attempt >= this.MAX_RETRIES) {
        throw error;
      }

      const delay = this.BASE_DELAY_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Falha ao conectar ao Discord (tentativa ${attempt}/${this.MAX_RETRIES}): ` +
          `${(error as Error).message}. Tentando novamente em ${delay / 1000}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.loginWithRetry(token, attempt + 1);
    }
  }

  async sendDealCard(dealId: string, data: DealCardData, imageUrl?: string | null) {
    const channel = await this.resolveChannel();
    if (!channel) {
      return;
    }

    try {
      const payload = this.embedBuilder.build(dealId, data, imageUrl);
      await channel.send(payload);
      this.logger.log(`Card do deal ${dealId} enviado ao Discord`);
    } catch (error) {
      this.logger.error(`Falha ao enviar card do deal ${dealId} ao Discord`, error as Error);
    }
  }

  async sendText(text: string) {
    const channel = await this.resolveChannel();
    if (!channel) {
      return;
    }

    try {
      await channel.send(text);
    } catch (error) {
      this.logger.error('Falha ao enviar mensagem ao Discord', error as Error);
    }
  }

  private async resolveChannel(): Promise<TextChannel | null> {
    const { channelId } = this.appConfig.discord;

    if (!channelId) {
      this.logger.warn('DISCORD_CHANNEL_ID nao configurado — mensagem nao enviada.');
      return null;
    }

    if (!this.ready) {
      this.logger.warn('Cliente do Discord ainda nao conectado — mensagem nao enviada.');
      return null;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        this.logger.error(`Canal ${channelId} nao e um canal de texto valido.`);
        return null;
      }

      return channel as TextChannel;
    } catch (error) {
      this.logger.error(`Nao foi possivel acessar o canal ${channelId}`, error as Error);
      return null;
    }
  }

  async onApplicationShutdown() {
    if (this.client.isReady()) {
      await this.client.destroy();
    }
  }
}
