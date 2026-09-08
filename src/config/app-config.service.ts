import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fachada tipada sobre o ConfigService. Centraliza todas as constantes de
 * negocio (secao 23 do briefing) para que nao fiquem espalhadas/hardcoded
 * pelo codigo. Alterar comportamento = alterar .env, nao o codigo-fonte.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get<number>('PORT', 3000);
  }

  get appUrl(): string {
    return this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  get logLevel(): string {
    return this.config.get<string>('LOG_LEVEL', 'debug');
  }

  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.config.getOrThrow<string>('REDIS_URL');
  }

  get telegram() {
    return {
      botToken: this.config.get<string>('TELEGRAM_BOT_TOKEN', ''),
      adminChatId: this.config.get<string>('TELEGRAM_ADMIN_CHAT_ID', ''),
    };
  }

  get shopee() {
    return {
      appId: this.config.get<string>('SHOPEE_APP_ID', ''),
      appSecret: this.config.get<string>('SHOPEE_APP_SECRET', ''),
      apiBaseUrl: this.config.get<string>(
        'SHOPEE_API_BASE_URL',
        'https://open-api.affiliate.shopee.com.br/graphql',
      ),
      mode: this.config.get<'mock' | 'live'>('SHOPEE_MODE', 'mock'),
    };
  }

  /** Regras de negocio para deteccao/publicacao de ofertas (secoes 9, 11, 23). */
  get dealRules() {
    return {
      minRealDiscount: this.config.get<number>('MIN_REAL_DISCOUNT', 0.1),
      publishScore: this.config.get<number>('PUBLISH_SCORE', 70),
      highScore: this.config.get<number>('HIGH_SCORE', 85),
      autoApproveScore: this.config.get<number>('AUTO_APPROVE_SCORE', 88),
      historyTargetDays: this.config.get<number>('HISTORY_TARGET_DAYS', 90),
    };
  }

  /** Tiers de polling (secao 20). */
  get pollingTiers() {
    return {
      hot: {
        size: this.config.get<number>('POLLING_HOT_SIZE', 300),
        intervalMin: this.config.get<number>('POLLING_HOT_INTERVAL_MIN', 15),
      },
      warm: {
        size: this.config.get<number>('POLLING_WARM_SIZE', 800),
        intervalMin: this.config.get<number>('POLLING_WARM_INTERVAL_MIN', 120),
      },
      cold: {
        intervalMin: this.config.get<number>('POLLING_COLD_INTERVAL_MIN', 1440),
      },
    };
  }
}
