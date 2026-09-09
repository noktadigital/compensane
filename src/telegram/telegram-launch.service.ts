import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

/**
 * Controla o launch() do bot manualmente (em vez de deixar o
 * nestjs-telegraf fazer isso na criacao do provider), porque o launch()
 * automatico da lib nao tem tratamento de erro: se a conexao com a API do
 * Telegram falhar (rede instavel, timeout), a promise rejeitada derruba o
 * processo inteiro via unhandled rejection — mesmo que API/jobs/banco
 * estivessem saudaveis.
 *
 * Aqui isolamos essa falha: se o launch falhar, tentamos novamente com
 * backoff em vez de matar a aplicacao. Enquanto o bot nao conecta, o resto
 * do sistema (coleta, analise, API HTTP) continua funcionando normalmente.
 */
@Injectable()
export class TelegramLaunchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramLaunchService.name);
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MS = 5000;
  private launched = false;

  constructor(@InjectBot() private readonly bot: Telegraf) {}

  onApplicationBootstrap() {
    // Nao bloqueia o boot da aplicacao esperando o Telegram responder.
    this.launchWithRetry(1).catch((error) => {
      this.logger.error(
        `Nao foi possivel conectar ao Telegram apos ${this.MAX_RETRIES} tentativas. O bot ficara offline; o resto do sistema continua rodando.`,
        error as Error,
      );
    });
  }

  private async launchWithRetry(attempt: number): Promise<void> {
    try {
      await this.bot.launch();
      this.launched = true;
      this.logger.log('Bot do Telegram conectado e escutando updates.');
    } catch (error) {
      if (attempt >= this.MAX_RETRIES) {
        throw error;
      }

      const delay = this.BASE_DELAY_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Falha ao conectar ao Telegram (tentativa ${attempt}/${this.MAX_RETRIES}): ${(error as Error).message}. Tentando novamente em ${delay / 1000}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.launchWithRetry(attempt + 1);
    }
  }

  onApplicationShutdown() {
    if (this.launched) {
      this.bot.stop();
    }
  }
}
