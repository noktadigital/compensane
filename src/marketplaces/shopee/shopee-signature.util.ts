import { createHash } from 'crypto';

/**
 * Assinatura HMAC-SHA256 exigida pela Shopee Affiliate Open API.
 * Formula (conforme documentacao da Shopee Open Platform):
 *   signature = SHA256(appId + timestamp + payload + appSecret)
 * O header Authorization e montado como:
 *   SHA256 Credential={appId}, Timestamp={timestamp}, Signature={signature}
 */
export function buildShopeeSignature(params: {
  appId: string;
  appSecret: string;
  timestamp: number;
  payload: string;
}): string {
  const { appId, appSecret, timestamp, payload } = params;
  const base = `${appId}${timestamp}${payload}${appSecret}`;
  return createHash('sha256').update(base).digest('hex');
}

export function buildShopeeAuthHeader(params: {
  appId: string;
  appSecret: string;
  timestamp: number;
  payload: string;
}): string {
  const signature = buildShopeeSignature(params);
  return `SHA256 Credential=${params.appId}, Timestamp=${params.timestamp}, Signature=${signature}`;
}
