/**
 * CONTENCAO DE CUSTO NO REDIS (Upstash cobra POR REQUISICAO).
 *
 * Um worker BullMQ ocioso NAO fica parado: ele faz polling bloqueante
 * continuo por jobs novos (brpoplpush/bzpopmin) e verifica jobs travados
 * periodicamente. Com os defaults (drainDelay 5s, stalledInterval 30s) e 9
 * filas, isso da ~155 mil comandos/dia SEM processar nada — foi o que
 * esgotou a cota de 500 mil/mes do plano free em poucos dias, com o sistema
 * praticamente parado.
 *
 * - drainDelay (segundos): quanto o worker fica bloqueado esperando um job
 *   novo antes de refazer a chamada. Valor alto = menos requisicoes. O custo
 *   e latencia para pegar o job, irrelevante aqui: nada neste sistema e
 *   sensivel a segundos (coleta roda a cada 15min, aprovacao e humana).
 * - stalledInterval (ms): frequencia da checagem de jobs travados.
 *
 * 300s/300s reduz o consumo ocioso em ~60x.
 *
 * IMPORTANTE: sao opcoes de WORKER, nao de Queue — nao funcionam no
 * BullModule.forRootAsync (que so aceita QueueOptions). Por isso sao
 * aplicadas em cada @Processor.
 */
export const LOW_COST_WORKER_OPTIONS = {
  drainDelay: 300,
  stalledInterval: 300_000,
} as const;
