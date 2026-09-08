import { Controller, Get, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { TrackingService } from '@/tracking/tracking.service';

/**
 * Redirecionador /r/{slug} (secao 15). Versao simplificada da V1: o slug e
 * o id do AffiliateLink. Registra o clique e redireciona para o link de
 * afiliado (shortLink quando disponivel, senao o link original).
 */
@Controller('r')
export class RedirectController {
  private readonly logger = new Logger(RedirectController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
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
    return res.redirect(302, destination);
  }
}
