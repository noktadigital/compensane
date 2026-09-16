/**
 * Nomes de fila (secao 19). Usamos "-" em vez de ":" porque o BullMQ usa ":"
 * como delimitador interno de chaves no Redis (nomes de fila com ":" quebram).
 * Conceitualmente estas filas correspondem a collect:shopee, record:prices etc.
 *
 * SO EXISTE FILA AQUI PARA TRABALHO QUE PRECISA DE RETRY/PERSISTENCIA. Cada
 * fila registrada mantem um worker perguntando "tem job novo?" 24/7, o que
 * custa ~744 comandos/hora no Redis mesmo sem trabalho nenhum — e o Upstash
 * cobra por requisicao. Foram removidas:
 *
 *   - analyze-deals / notify-discord: eram um calculo local e uma chamada
 *     HTTP. Rodam direto no RecordPricesProcessor.
 *   - cleanup-data: era uma unica query diaria. Virou metodo do scheduler.
 *   - collect/discover-mercado-livre: ML bloqueado por 403, nao coleta nada.
 */
export const QUEUE_COLLECT_SHOPEE = 'collect-shopee';
export const QUEUE_RECORD_PRICES = 'record-prices';
export const QUEUE_AGGREGATE_DAILY = 'aggregate-daily';

export const JOB_COLLECT_TIER = 'collect-tier';
export const JOB_RECORD_PRICE = 'record-price';
export const JOB_AGGREGATE_DAILY = 'aggregate-daily';
