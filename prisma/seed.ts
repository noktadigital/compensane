import { PrismaClient, Marketplace } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Keywords iniciais (secao 21) — ponto de partida configuravel, nao definitivo.
 *
 * REGRA APRENDIDA NA PRATICA: termo generico traz acessorio barato, nao o
 * produto. A busca da Shopee casa por texto do titulo, entao qualquer item
 * que CITE a palavra entra no resultado. Verificado contra a API real:
 *
 *   "monitor"       -> prateleira, kit de limpeza de tela, sensor de diabetes
 *   "celular"       -> cabo USB, pelicula, porta-celular
 *   "ssd"           -> case de HD, computador completo
 *   "whey protein"  -> shampoo e mascara capilar "Whey Protein Hair"
 *
 * Com termo especifico o resultado vira o produto de verdade:
 *
 *   "ssd 1tb nvme"     -> Samsung 980 Pro, Kingston NV3, Netac N930E
 *   "smartphone 128gb" -> LG K61, Poco C81, Galaxy A32
 *
 * Ao adicionar keyword nova, rode a busca antes e confira o que volta.
 * Incluir unidade/capacidade (1tb, 128gb, 1kg) e o que mais ajuda a
 * desambiguar produto de acessorio.
 */
const SEED_KEYWORDS: { keyword: string; priority: number }[] = [
  // Suplementos: "whey protein" sozinho cai em linha capilar homonima.
  { keyword: 'whey protein 1kg', priority: 10 },
  { keyword: 'whey isolado', priority: 9 },
  // "creatina" ja retorna o produto certo sem qualificador.
  { keyword: 'creatina monohidratada', priority: 9 },
  // Eletro: "air fryer" traz botao de reposicao e forma de silicone junto,
  // mas tambem as fritadeiras — mantido, com a versao qualificada ao lado.
  { keyword: 'air fryer', priority: 8 },
  { keyword: 'fritadeira eletrica sem oleo', priority: 8 },
  // Audio: "fone bluetooth" funciona; a variante TWS afina o resultado.
  { keyword: 'fone bluetooth tws', priority: 7 },
  // Informatica: os genericos ("ssd", "monitor") eram inutilizaveis.
  { keyword: 'ssd 1tb nvme', priority: 6 },
  { keyword: 'monitor gamer 144hz', priority: 5 },
  { keyword: 'smartphone 128gb', priority: 4 },
];

/**
 * Keywords genericas demais, mantidas aqui para serem DESABILITADAS.
 *
 * O seed usa upsert: remover um termo da lista acima nao o apaga de bancos
 * que ja rodaram o seed antigo — ele continuaria ativo e coletando lixo.
 * Desabilitar explicitamente e o que garante que o ajuste alcance tambem as
 * bases existentes. Nao apagamos a linha para preservar o historico ja
 * coletado sob essas keywords.
 */
const DISABLED_KEYWORDS = ['whey protein', 'ssd', 'monitor', 'celular'];

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
        update: { priority: kw.priority, enabled: true },
      });
    }

    const { count } = await prisma.searchKeyword.updateMany({
      where: { marketplace, keyword: { in: DISABLED_KEYWORDS } },
      data: { enabled: false },
    });

    if (count > 0) {
      console.log(`${marketplace}: ${count} keyword(s) generica(s) desabilitada(s).`);
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
