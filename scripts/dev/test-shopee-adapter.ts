/**
 * Teste end-to-end do ShopeeLiveAdapter contra a API real.
 * Valida as tres correcoes feitas apos a introspeccao do schema:
 *   1. searchOffers  — busca por keyword + campos novos (shopName, priceDiscountRate)
 *   2. getOffersByIds — itemId unico com Int64 como string (base do polling)
 *   3. generateAffiliateLink — mutation com input object ShortLinkInput
 *
 * Instancia o adapter direto, sem subir o app Nest (nao toca o banco, entao
 * nao consome conexao do pool do Supabase).
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/dev/test-shopee-adapter.ts
 */
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../src/config/app-config.service';
import { ShopeeLiveAdapter } from '../../src/marketplaces/shopee/shopee-live.adapter';

config();

async function main() {
  const appConfig = new AppConfigService(new ConfigService(process.env));
  const adapter = new ShopeeLiveAdapter(appConfig);

  console.log(`Modo Shopee configurado: ${appConfig.shopee.mode}`);

  // --- 1. Busca por palavra-chave ---
  console.log(`\n${'='.repeat(70)}\n1. searchOffers("fone bluetooth")\n${'='.repeat(70)}`);
  const found = await adapter.searchOffers({ keyword: 'fone bluetooth', pageSize: 3 });
  console.log(`Ofertas retornadas: ${found.length}`);
  for (const offer of found) {
    console.log(
      `  [${offer.externalId}] ${offer.title.slice(0, 55)}\n` +
        `      preco=R$ ${(offer.priceCents / 100).toFixed(2)} | ` +
        `loja=${offer.sellerName ?? '?'} | ` +
        `comissao=${((offer.commissionRateBp ?? 0) / 100).toFixed(1)}% | ` +
        `desconto anunciado=${
          offer.discountRate != null ? `${(offer.discountRate * 100).toFixed(0)}%` : 'n/a'
        }`,
    );
  }

  if (found.length === 0) {
    console.error('Nenhuma oferta retornada — nao da para seguir com os testes 2 e 3.');
    process.exit(1);
  }

  // --- 2. Polling por id (o que alimenta o historico de precos) ---
  const target = found[0];
  console.log(`\n${'='.repeat(70)}\n2. getOffersByIds([${target.externalId}])\n${'='.repeat(70)}`);
  const polled = await adapter.getOffersByIds({ externalIds: [target.externalId] });
  console.log(`Ofertas retornadas: ${polled.length}`);
  if (polled[0]) {
    console.log(
      `  ${polled[0].title.slice(0, 55)} — R$ ${(polled[0].priceCents / 100).toFixed(2)}`,
    );
  }

  // --- 3. Geracao de link de afiliado com subId ---
  console.log(`\n${'='.repeat(70)}\n3. generateAffiliateLink\n${'='.repeat(70)}`);
  console.log(`  origem: ${target.url}`);
  const link = await adapter.generateAffiliateLink(target);
  console.log(`  shortLink: ${link.shortLink ?? '(nenhum)'}`);
  console.log(`  subId:     ${link.subId ?? '(sem subId — caiu no fallback)'}`);

  console.log('\nOK — as tres operacoes responderam.');
}

main().catch((err) => {
  console.error('\nFalhou:', err);
  process.exit(1);
});
