import { Controller, Get, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { TrackingService } from '@/tracking/tracking.service';
import { AppConfigService } from '@/config/app-config.service';

/**
 * Folga antes do redirect para o Facebook Pixel conseguir enviar os eventos
 * (PageView + ClickToChannel). Sem isso, a navegacao cancela a requisicao e
 * boa parte dos cliques nao e contabilizada.
 */
const REDIRECT_DELAY_MS = 600;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Redirecionador /r/{slug} (secao 15). Versao simplificada da V1: o slug e
 * o id do AffiliateLink. Registra o clique e redireciona para o link de
 * afiliado (shortLink quando disponivel, senao o link original).
 *
 * Sempre serve uma pagina HTML com meta tags Open Graph antes de
 * redirecionar (em vez de um HTTP redirect puro), porque redes sociais
 * como Facebook/Instagram Ads leem o preview (imagem/titulo) da PRIMEIRA
 * URL do anuncio — se essa URL for diretamente o link de destino (ex:
 * WhatsApp), o preview mostra a imagem/logo de la, nao a arte da campanha.
 * Servindo essa pagina intermediaria, o crawler do Facebook le nossas tags
 * (imagem da marca) e o navegador do usuario e redirecionado
 * instantaneamente via meta refresh — sem diferenca perceptivel para quem
 * clica.
 */
@Controller('r')
export class RedirectController {
  private readonly logger = new Logger(RedirectController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly appConfig: AppConfigService,
  ) {}

  /**
   * Rota fixa para divulgacao do canal do WhatsApp em si (ex: anuncios do
   * tipo "Siga o canal"), sem depender de nenhum AffiliateLink no banco.
   * Precisa vir ANTES de :slug na ordem de declaracao das rotas do Nest.
   */
  @Get('canal')
  async redirectToChannel(@Req() req: Request, @Res() res: Response) {
    const { channelUrl } = this.appConfig.socialPreview;

    if (!channelUrl) {
      throw new NotFoundException('WHATSAPP_CHANNEL_URL nao configurado.');
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const ipHash = ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : undefined;

    await this.trackingService.recordClick({
      slug: 'canal',
      ipHash,
      userAgent: req.headers['user-agent'],
    });

    const html = this.buildPreviewPage(channelUrl, 'canal');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  @Get(':slug')
  async redirect(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const affiliateLink = await this.prisma.affiliateLink.findUnique({
      where: { id: slug },
    });

    if (!affiliateLink) {
      throw new NotFoundException('Link nao encontrado');
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const ipHash = ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : undefined;

    await this.trackingService.recordClick({
      slug,
      dealId: affiliateLink.dealId ?? undefined,
      affiliateLinkId: affiliateLink.id,
      ipHash,
      userAgent: req.headers['user-agent'],
    });

    const destination = affiliateLink.shortLink ?? affiliateLink.originalLink;
    const html = this.buildPreviewPage(destination, slug);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  private buildPreviewPage(destination: string, slug: string): string {
    const { imageUrl, title, description, imageWidth, imageHeight, facebookPixelId } =
      this.appConfig.socialPreview;
    const pageUrl = `${this.appConfig.appUrl}/r/${slug}`;

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeDestination = escapeHtml(destination);

    // NAO usar <meta http-equiv="refresh">: o crawler do Facebook OBEDECE
    // essa tag, segue para o destino (whatsapp.com, dominio da propria Meta)
    // e aborta com "Os URLs do Facebook nao podem ser rastreados" antes de
    // ler as tags og daqui. O redirecionamento tem que ser so via JavaScript,
    // que o crawler nao executa — ele fica na pagina e le o preview correto,
    // enquanto a pessoa real e redirecionada normalmente.
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ''}
${imageUrl && imageWidth ? `<meta property="og:image:width" content="${escapeHtml(imageWidth)}">` : ''}
${imageUrl && imageHeight ? `<meta property="og:image:height" content="${escapeHtml(imageHeight)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : ''}
${facebookPixelId ? this.buildPixelSnippet(facebookPixelId, slug) : ''}
</head>
<body>
<p>Redirecionando... <a href="${safeDestination}">clique aqui se nao for redirecionado automaticamente</a>.</p>
<script>
setTimeout(function () {
  window.location.replace(${JSON.stringify(destination)});
}, ${REDIRECT_DELAY_MS});
</script>
</body>
</html>`;
  }

  /**
   * Snippet do Facebook Pixel. Dispara PageView e um evento customizado
   * identificando qual link foi clicado, permitindo otimizar a campanha
   * por essa acao no Gerenciador de Anuncios. O redirect so acontece apos
   * REDIRECT_DELAY_MS para dar tempo do evento ser enviado — sem essa
   * folga, a navegacao cancela a requisicao e o clique nao e contabilizado.
   */
  private buildPixelSnippet(pixelId: string, slug: string): string {
    return `<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(pixelId)});
fbq('track', 'PageView');
fbq('trackCustom', 'ClickToChannel', { slug: ${JSON.stringify(slug)} });
</script>
<noscript><img height="1" width="1" style="display:none" alt=""
src="https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1"></noscript>`;
  }
}
