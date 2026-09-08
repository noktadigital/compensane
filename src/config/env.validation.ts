import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV: string = 'development';

  @IsInt()
  @IsOptional()
  PORT: number = 3000;

  @IsUrl({ require_tld: false })
  @IsOptional()
  APP_URL: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'debug';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsOptional()
  TELEGRAM_BOT_TOKEN?: string;

  @IsString()
  @IsOptional()
  TELEGRAM_ADMIN_CHAT_ID?: string;

  @IsString()
  @IsOptional()
  SHOPEE_APP_ID?: string;

  @IsString()
  @IsOptional()
  SHOPEE_APP_SECRET?: string;

  @IsString()
  @IsOptional()
  SHOPEE_API_BASE_URL?: string = 'https://open-api.affiliate.shopee.com.br/graphql';

  @IsIn(['mock', 'live'])
  @IsOptional()
  SHOPEE_MODE: string = 'mock';

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  MIN_REAL_DISCOUNT: number = 0.1;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  PUBLISH_SCORE: number = 70;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  HIGH_SCORE: number = 85;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  AUTO_APPROVE_SCORE: number = 88;

  @IsInt()
  @Min(1)
  @IsOptional()
  HISTORY_TARGET_DAYS: number = 90;

  @IsInt()
  @Min(1)
  @IsOptional()
  POLLING_HOT_SIZE: number = 300;

  @IsInt()
  @Min(1)
  @IsOptional()
  POLLING_HOT_INTERVAL_MIN: number = 15;

  @IsInt()
  @Min(1)
  @IsOptional()
  POLLING_WARM_SIZE: number = 800;

  @IsInt()
  @Min(1)
  @IsOptional()
  POLLING_WARM_INTERVAL_MIN: number = 120;

  @IsInt()
  @Min(1)
  @IsOptional()
  POLLING_COLD_INTERVAL_MIN: number = 1440;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => Object.values(err.constraints ?? {}).join(', '))
      .join('\n');
    throw new Error(`Configuracao de ambiente invalida:\n${messages}`);
  }

  return validatedConfig;
}
