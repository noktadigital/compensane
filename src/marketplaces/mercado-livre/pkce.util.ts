import { createHash, randomBytes } from 'crypto';

/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) para o fluxo OAuth2 do
 * Mercado Livre. O code_verifier e um segredo gerado no inicio do fluxo de
 * autorizacao; o code_challenge (hash SHA-256 do verifier) e enviado na
 * URL de autorizacao. Na troca do codigo por token, enviamos o
 * code_verifier original para o ML validar que quem esta trocando o
 * codigo e quem iniciou o fluxo.
 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());

  return { codeVerifier, codeChallenge };
}
