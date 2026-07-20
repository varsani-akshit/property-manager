import { config } from "dotenv";
import { Client } from "pg";
config({ path: ".env" });
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  // Warm up
  await c.query("select public.dashboard_snapshot('2026-06-20', '2026-07-20')");
  // Time 5 runs
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await c.query("select public.dashboard_snapshot('2026-06-20', '2026-07-20')");
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`dashboard_snapshot avg: ${avg.toFixed(0)}ms (min ${Math.min(...times).toFixed(0)}ms, max ${Math.max(...times).toFixed(0)}ms)`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
