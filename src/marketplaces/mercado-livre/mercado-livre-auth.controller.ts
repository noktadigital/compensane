import { BadRequestException, Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

/**
 * Rotas administrativas para autorizar a integracao com o Mercado Livre
 * (fluxo OAuth2 + PKCE). Uso: acessar GET /marketplaces/mercado-livre/auth
 * uma vez no navegador, logar com a conta de afiliado, e o ML redireciona
 * de volta para /marketplaces/mercado-livre/callback com o codigo, que e
 * trocado automaticamente por access_token/refresh_token (persistidos no
 * banco). Nao e uma tela publica — nao expor este link sem controle de
 * acesso quando o sistema deixar de ser uso pessoal/interno.
 */
@Controller('marketplaces/mercado-livre')
export class MercadoLivreAuthController {
  private readonly logger = new Logger(MercadoLivreAuthController.name);

  constructor(private readonly oauthService: MercadoLivreOAuthService) {}

  @Get('auth')
  startAuthorization(@Res() res: Response) {
    const url = this.oauthService.buildAuthorizationUrl();
    return res.redirect(url);
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('error') error: string) {
    if (error) {
      throw new BadRequestException(`Mercado Livre retornou erro: ${error}`);
    }

    if (!code) {
      throw new BadRequestException('Parametro code ausente no callback do Mercado Livre.');
    }

    const token = await this.oauthService.exchangeCodeForToken(code);
    this.logger.log(`Mercado Livre autorizado com sucesso (userId=${token.userId}).`);

    return {
      status: 'ok',
      message: 'Mercado Livre autorizado com sucesso. Pode fechar esta janela.',
      userId: token.userId,
      expiresAt: token.expiresAt,
    };
  }

  @Get('status')
  async status() {
    const authorized = await this.oauthService.isAuthorized();
    return { authorized };
  }
}
