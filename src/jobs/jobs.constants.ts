/**
 * Nomes de fila (secao 19). Cada marketplace tem sua propria fila de coleta
 * para isolar rate limits. Usamos "-" em vez de ":" porque o BullMQ usa ":"
 * como delimitador interno de chaves no Redis (nomes de fila com ":" quebram).
 * Conceitualmente estas filas correspondem a collect:shopee, record:prices etc.
 */
export const QUEUE_COLLECT_SHOPEE = 'collect-shopee';
export const QUEUE_RECORD_PRICES = 'record-prices';
export const QUEUE_AGGREGATE_DAILY = 'aggregate-daily';
export const QUEUE_ANALYZE_DEALS = 'analyze-deals';
export const QUEUE_NOTIFY_TELEGRAM = 'notify-telegram';
export const QUEUE_CLEANUP_DATA = 'cleanup-data';

export const JOB_COLLECT_TIER = 'collect-tier';
export const JOB_RECORD_PRICE = 'record-price';
export const JOB_AGGREGATE_DAILY = 'aggregate-daily';
export const JOB_ANALYZE_DEAL = 'analyze-deal';
export const JOB_NOTIFY_DEAL = 'notify-deal';
export const JOB_CLEANUP = 'cleanup';
