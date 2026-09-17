import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_DISCOVER_SHOPEE, JOB_DISCOVER_KEYWORD } from './processors/discover-shopee.processor';

/**
 * Disparo manual da descoberta.
 *
 * Existe porque o Redis do Render e interno: nao da para enfileirar um job
 * de fora, e sem isto a unica forma de rodar a descoberta fora de hora e
 * esperar o proximo horario agendado.
 *
 * Protegido por token: o endpoint gasta cota da API da Shopee e envia cards
 * ao Discord, entao aberto seria um convite a abuso.
 */
@Controller('admin')
export class JobsAdminController {
  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_DISCOVER_SHOPEE) private readonly discoverQueue: Queue,
  ) {}

  @Post('descobrir')
  async descobrir(@Headers('x-admin-token') token?: string) {
    const esperado = this.config.get<string>('ADMIN_TOKEN');

    // Sem token configurado o endpoint fica fechado, nao aberto: um deploy
    // que esqueceu a variavel nao pode virar porta destrancada.
    if (!esperado) {
      throw new BadRequestException('ADMIN_TOKEN nao configurado.');
    }

    if (token !== esperado) {
      throw new UnauthorizedException();
    }

    const job = await this.discoverQueue.add(
      JOB_DISCOVER_KEYWORD,
      {},
      { removeOnComplete: 5, removeOnFail: 10, attempts: 2 },
    );

    return { enfileirado: true, jobId: job.id };
  }
}
