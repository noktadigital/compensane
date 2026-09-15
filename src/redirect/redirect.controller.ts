import { Controller, Get, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { TrackingService } from '@/tracking/tracking.service';
import { AppConfigService } from '@/config/app-config.service';

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
    const { imageUrl, title, description } = this.appConfig.socialPreview;
    const pageUrl = `${this.appConfig.appUrl}/r/${slug}`;

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeDestination = escapeHtml(destination);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${safeDestination}">
<title>${safeTitle}</title>
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : ''}
</head>
<body>
<p>Redirecionando... <a href="${safeDestination}">clique aqui se nao for redirecionado automaticamente</a>.</p>
<script>window.location.replace(${JSON.stringify(destination)});</script>
</body>
</html>`;
  }
}
