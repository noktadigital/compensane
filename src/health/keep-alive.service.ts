import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';

/**
 * Intervalo entre pings. O Render hiberna o servico depois de ~15 minutos
 * sem trafego HTTP; 10 minutos deixa margem confortavel sem gerar trafego
 * desnecessario.
 */
const PING_INTERVAL_MS = 10 * 60_000;

/**
 * Mantem o servico acordado se auto-pingando.
 *
 * POR QUE ISTO EXISTE: no plano free o Render hiberna apos ~15min sem
 * requisicao HTTP, e um servico dormindo quebra o sistema em dois pontos
 * que sao justamente os que importam:
 *
 *   - o bot do Discord fica offline, entao clicar em APROVAR falha com
 *     "nao respondeu a tempo" (medido: acordar levou 42s, muito acima dos
 *     3s que o Discord da para responder uma interacao)
 *   - as coletas de 8h/12h/16h/20h simplesmente nao disparam, porque o
 *     processo que conta as horas nao esta rodando
 *
 * LIMITE HONESTO: isto resolve a hibernacao por inatividade, nao o limite
 * de horas mensais do plano free. Um servico que nunca dorme consome as
 * horas gratuitas continuamente; se elas acabarem no meio do mes, o
 * servico para de qualquer forma. A solucao definitiva e o plano pago.
 *
 * Nao roda em desenvolvimento: pingar localhost em loop nao serve para nada
 * e so polui o log.
 */
@Injectable()
export class KeepAliveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeepAliveService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly appConfig: AppConfigService) {}

  onModuleInit() {
    const url = this.appConfig.appUrl;

    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      this.logger.log('APP_URL local — keep-alive desligado.');
      return;
    }

    // unref() para o timer nao segurar o processo aberto no shutdown.
    this.timer = setInterval(() => void this.ping(url), PING_INTERVAL_MS);
    this.timer.unref();

    this.logger.log(`Keep-alive ativo: ping em ${url}/health a cada 10min.`);
  }

  private async ping(baseUrl: string): Promise<void> {
    try {
      // AbortSignal.timeout: sem isso um fetch pendurado vaza a cada ciclo.
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        this.logger.warn(`Keep-alive respondeu ${res.status}.`);
      }
    } catch (error) {
      // Falhar aqui nao pode derrubar nada: o proximo ciclo tenta de novo.
      this.logger.warn(`Keep-alive falhou: ${(error as Error).message}`);
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
