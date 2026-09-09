import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { createLoggerOptions } from './common/logger/logger.config';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createLoggerOptions()),
  });

  // Rede de seguranca: uma promise rejeitada nao tratada em alguma
  // integracao externa (ex: Telegram, chamadas de marketplace) nunca deve
  // derrubar o processo inteiro silenciosamente. Loga e segue rodando.
  process.on('unhandledRejection', (reason) => {
    Logger.error('Unhandled promise rejection', reason as Error, 'Process');
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
