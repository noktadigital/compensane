import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Guild,
  TextChannel,
} from 'discord.js';
import { DiscordClientService } from './discord-client.service';

/**
 * Teto de canais de post abertos ao mesmo tempo.
 *
 * O Discord limita um servidor a 500 canais. Cada aprovacao cria um canal,
 * entao sem freio uma sequencia de aprovacoes sem encerramento bate no teto
 * e quebra ate a criacao de canais legitimos. 180 deixa folga larga e ja
 * sinaliza muito antes do limite real que a fila de postagem esta acumulando.
 */
const MAX_CANAIS_ABERTOS = 180;

/** Prefixo que identifica os canais gerenciados por este servico. */
const PREFIXO = 'post-';

/**
 * Cada oferta aprovada ganha um canal proprio na barra lateral, com o texto
 * pronto para o WhatsApp e um botao ENCERRAR que apaga o canal.
 *
 * POR QUE CANAL E NAO THREAD: thread aparece aninhada dentro do #geral, nao
 * como item da lista lateral. O fluxo pedido e "aprovo varias, depois
 * finalizo uma por uma" — e isso exige que cada post pendente seja visivel
 * na lateral sem abrir o canal de ofertas.
 */
@Injectable()
export class PostChannelService {
  private readonly logger = new Logger(PostChannelService.name);

  constructor(private readonly discord: DiscordClientService) {}

  /**
   * Cria o canal do post. Devolve null quando nao foi possivel — o chamador
   * decide o que dizer ao usuario, porque aqui nao ha interacao para
   * responder.
   */
  async abrir(params: {
    dealId: string;
    titulo: string;
    postText: string;
    guild: Guild;
    parentId: string | null;
  }): Promise<TextChannel | null> {
    const { dealId, titulo, postText, guild, parentId } = params;

    const abertos = guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildText && c.name.startsWith(PREFIXO),
    ).size;

    if (abertos >= MAX_CANAIS_ABERTOS) {
      this.logger.warn(
        `${abertos} canais de post abertos — limite de ${MAX_CANAIS_ABERTOS} atingido.`,
      );
      return null;
    }

    try {
      const canal = await guild.channels.create({
        name: this.nomeDoCanal(titulo),
        type: ChannelType.GuildText,
        parent: parentId ?? undefined,
        // O topico guarda o dealId: e como o botao ENCERRAR sabe qual deal
        // encerrar mesmo depois de um restart do bot, sem estado em memoria.
        topic: `deal:${dealId}`,
      });

      const encerrar = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`post:close:${dealId}`)
          .setLabel('Encerrar')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✅'),
      );

      // Bloco de codigo: o Discord da um botao de copiar nativo e o markdown
      // do texto nao e interpretado.
      await canal.send({
        content: `\`\`\`\n${postText}\n\`\`\``,
        components: [encerrar],
      });

      this.logger.log(`Canal de post criado para o deal ${dealId}: #${canal.name}`);
      return canal;
    } catch (error) {
      this.logger.error(
        `Falha ao criar canal de post do deal ${dealId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Apaga o canal do post. */
  async encerrar(canal: TextChannel): Promise<void> {
    await canal.delete('Post encerrado pelo usuario');
  }

  /**
   * Nome do canal a partir do titulo do produto: o Discord aceita ate 100
   * caracteres, minusculas, sem espacos. Cortar em 40 mantem a lista lateral
   * legivel — nome longo e truncado com reticencias na propria UI.
   */
  private nomeDoCanal(titulo: string): string {
    const slug = titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');

    return `${PREFIXO}${slug || 'oferta'}`;
  }
}
