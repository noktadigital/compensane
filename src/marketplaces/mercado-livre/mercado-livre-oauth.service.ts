import { Injectable, Logger } from '@nestjs/common';
import { Marketplace, MarketplaceOAuthToken } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { AppConfigService } from '@/config/app-config.service';
import { generatePkcePair, PkcePair } from './pkce.util';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token?: string;
}

/**
 * Gerencia o ciclo de vida do token OAuth2 do Mercado Livre (secao 4 do
 * briefing generalizada para OAuth): autorizacao inicial (PKCE),
 * persistencia do access_token/refresh_token no banco (MarketplaceOAuthToken),
 * e renovacao automatica antes de cada uso.
 *
 * IMPORTANTE: o access_token expira em 6 horas e o refresh_token do ML e de
 * uso UNICO — a cada renovacao, o ML devolve um refresh_token novo que
 * substitui o anterior. Nunca reusar um refresh_token ja trocado.
 */
@Injectable()
export class MercadoLivreOAuthService {
  private readonly logger = new Logger(MercadoLivreOAuthService.name);
  /** Guarda o code_verifier gerado durante o fluxo de autorizacao ate o callback chegar. */
  private pendingPkce: PkcePair | null = null;
  /** Margem de seguranca antes do expiresAt real para renovar com folga. */
  private readonly EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
  ) {}

  /** Monta a URL de autorizacao que o operador deve abrir no navegador uma unica vez. */
  buildAuthorizationUrl(): string {
    const { clientId, redirectUri, authBaseUrl } = this.appConfig.mercadoLivre;

    if (!clientId || !redirectUri) {
      throw new Error(
        'MERCADO_LIVRE_CLIENT_ID e MERCADO_LIVRE_REDIRECT_URI precisam estar configurados.',
      );
    }

    const pkce = generatePkcePair();
    this.pendingPkce = pkce;

    const url = new URL(`${authBaseUrl}/authorization`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return url.toString();
  }

  /** Troca o codigo de autorizacao (recebido no callback) pelo primeiro access_token/refresh_token. */
  async exchangeCodeForToken(code: string): Promise<MarketplaceOAuthToken> {
    const { clientId, clientSecret, redirectUri, apiBaseUrl } = this.appConfig.mercadoLivre;

    if (!this.pendingPkce) {
      throw new Error(
        'Nenhum fluxo de autorizacao em andamento (code_verifier ausente). Inicie novamente em /marketplaces/mercado-livre/auth.',
      );
    }

    const response = await fetch(`${apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: this.pendingPkce.codeVerifier,
      }),
    });

    this.pendingPkce = null;

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Falha ao trocar codigo por token: ${response.status} ${text}`);
      throw new Error(`Mercado Livre OAuth error: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    return this.persistToken(data);
  }

  /** Retorna um access_token valido, renovando automaticamente se estiver perto de expirar. */
  async getValidAccessToken(): Promise<string> {
    const stored = await this.prisma.marketplaceOAuthToken.findUnique({
      where: { marketplace: Marketplace.MERCADO_LIVRE },
    });

    if (!stored) {
      throw new Error(
        'Mercado Livre ainda nao foi autorizado. Acesse /marketplaces/mercado-livre/auth para autorizar.',
      );
    }

    const willExpireSoon = stored.expiresAt.getTime() - Date.now() < this.EXPIRY_SAFETY_MARGIN_MS;

    if (!willExpireSoon) {
      return stored.accessToken;
    }

    const refreshed = await this.refreshToken(stored.refreshToken);
    return refreshed.accessToken;
  }

  private async refreshToken(refreshToken: string): Promise<MarketplaceOAuthToken> {
    const { clientId, clientSecret, apiBaseUrl } = this.appConfig.mercadoLivre;

    const response = await fetch(`${apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Falha ao renovar token: ${response.status} ${text}`);
      throw new Error(`Mercado Livre OAuth refresh error: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.logger.log('Token do Mercado Livre renovado com sucesso.');
    return this.persistToken(data);
  }

  private async persistToken(data: TokenResponse): Promise<MarketplaceOAuthToken> {
    if (!data.refresh_token) {
      throw new Error(
        'Resposta do Mercado Livre nao incluiu refresh_token. Confirme que o app tem o scope offline_access.',
      );
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    return this.prisma.marketplaceOAuthToken.upsert({
      where: { marketplace: Marketplace.MERCADO_LIVRE },
      create: {
        marketplace: Marketplace.MERCADO_LIVRE,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        scope: data.scope,
        userId: String(data.user_id),
      },
      update: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        scope: data.scope,
        userId: String(data.user_id),
      },
    });
  }

  async isAuthorized(): Promise<boolean> {
    const stored = await this.prisma.marketplaceOAuthToken.findUnique({
      where: { marketplace: Marketplace.MERCADO_LIVRE },
    });
    return stored !== null;
  }
}
