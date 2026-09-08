import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Markup } from 'telegraf';
import { AppConfigService } from '@/config/app-config.service';
import { PostTemplateService, TelegramCardData } from '@/posts/post-template.service';

/**
 * Encapsula o envio de mensagens/cards do bot (secao 12). Mantido separado
 * do Update/handler para que o disparo de notificacoes (a partir de jobs)
 * nao precise conhecer detalhes de roteamento de comandos do Telegraf.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly appConfig: AppConfigService,
    private readonly postTemplate: PostTemplateService,
  ) {}

  async sendDealCard(dealId: string, data: TelegramCardData, imageUrl?: string | null) {
    const chatId = this.appConfig.telegram.adminChatId;
    if (!chatId) {
      this.logger.warn('TELEGRAM_ADMIN_CHAT_ID nao configurado — card nao enviado.');
      return;
    }

    const caption = this.postTemplate.buildTelegramCard(data);
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ APROVAR', `deal:approve:${dealId}`),
        Markup.button.callback('❌ REJEITAR', `deal:reject:${dealId}`),
      ],
      [Markup.button.url('🔗 VER PRODUTO', data.link)],
    ]);

    try {
      if (imageUrl) {
        await this.bot.telegram.sendPhoto(chatId, imageUrl, {
          caption,
          ...keyboard,
        });
      } else {
        await this.bot.telegram.sendMessage(chatId, caption, keyboard);
      }
      this.logger.log(`Card do deal ${dealId} enviado ao Telegram`);
    } catch (error) {
      this.logger.error(`Falha ao enviar card do deal ${dealId} ao Telegram`, error as Error);
    }
  }

  async sendText(text: string) {
    const chatId = this.appConfig.telegram.adminChatId;
    if (!chatId) {
      this.logger.warn('TELEGRAM_ADMIN_CHAT_ID nao configurado — mensagem nao enviada.');
      return;
    }
    await this.bot.telegram.sendMessage(chatId, text);
  }
}
