import { config } from 'dotenv';
import Redis from 'ioredis';
config();
async function main() {
  const r = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2, lazyConnect: true, enableReadyCheck: false });
  await r.connect();

  const lines = String(await r.client('LIST')).trim().split('\n').filter(Boolean);
  console.log(`=== ${lines.length} conexoes ===`);
  const ips = new Map<string, number>();
  for (const l of lines) {
    const ip = (/addr=([\d.]+)/.exec(l)?.[1]) ?? '?';
    ips.set(ip, (ips.get(ip) ?? 0) + 1);
  }
  for (const [ip, n] of ips) console.log(`  ${ip}: ${n}`);

  console.log('\n=== amostra de comandos (MONITOR 5s) ===');
  const mon = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  const counts = new Map<string, number>();
  let total = 0;
  try {
    const m: any = await (mon as any).monitor();
    m.on('monitor', (_t: any, args: string[]) => {
      total++;
      const key = `${args[0]} ${args[2] ?? ''}`.slice(0, 60);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    await new Promise(res => setTimeout(res, 5000));
    m.disconnect();
  } catch (e) {
    console.log('MONITOR indisponivel:', (e as Error).message);
  }
  console.log(`total em 5s: ${total}  ->  ${Math.round(total/5*3600)}/h`);
  const top = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
  for (const [k, v] of top) console.log(`  ${String(v).padStart(5)}x  ${k}`);
  r.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
