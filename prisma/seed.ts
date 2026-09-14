import { PrismaClient, Marketplace } from '@prisma/client';

const prisma = new PrismaClient();

/** Keywords iniciais de exemplo (secao 21) — nao definitivas, apenas ponto de partida configuravel. */
const SEED_KEYWORDS: { keyword: string; priority: number }[] = [
  { keyword: 'whey protein', priority: 10 },
  { keyword: 'creatina', priority: 9 },
  { keyword: 'air fryer', priority: 8 },
  { keyword: 'fone bluetooth', priority: 7 },
  { keyword: 'ssd', priority: 6 },
  { keyword: 'monitor', priority: 5 },
  { keyword: 'celular', priority: 4 },
];

const SEED_MARKETPLACES: Marketplace[] = [Marketplace.SHOPEE, Marketplace.MERCADO_LIVRE];

async function main() {
  for (const marketplace of SEED_MARKETPLACES) {
    for (const kw of SEED_KEYWORDS) {
      await prisma.searchKeyword.upsert({
        where: { marketplace_keyword: { marketplace, keyword: kw.keyword } },
        create: {
          marketplace,
          keyword: kw.keyword,
          priority: kw.priority,
          enabled: true,
        },
        update: { priority: kw.priority },
      });
    }
  }

  console.log(
    `Seed concluido: ${SEED_KEYWORDS.length} keywords x ${SEED_MARKETPLACES.length} marketplaces`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
