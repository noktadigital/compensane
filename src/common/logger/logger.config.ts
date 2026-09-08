import { WinstonModuleOptions, utilities as nestWinstonUtils } from 'nest-winston';
import * as winston from 'winston';

/**
 * Logger estruturado (secao 25). Em desenvolvimento usa formato legivel no
 * console; em producao emite JSON para facilitar ingestao por ferramentas
 * de observabilidade.
 */
export function createLoggerOptions(): WinstonModuleOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const level = process.env.LOG_LEVEL ?? 'debug';

  return {
    level,
    transports: [
      new winston.transports.Console({
        format: isProduction
          ? winston.format.combine(winston.format.timestamp(), winston.format.json())
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.ms(),
              nestWinstonUtils.format.nestLike('Achadinhos', {
                colors: true,
                prettyPrint: true,
              }),
            ),
      }),
    ],
  };
}
