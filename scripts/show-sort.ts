// Shows current alpha-name sort order per compound so we can see which
// compounds start at "10" instead of "1".
import { config } from "dotenv";
import { Client } from "pg";
config({ path: ".env" });
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await client.connect();
  const { rows } = await client.query(`
    select c.name as compound, p.name as property
    from public.properties p
    join public.compounds c on c.id = p.compound_id
    where p.archived = false
    order by c.name, p.name
  `);
  let last = "";
  for (const r of rows) {
    if (r.compound !== last) { console.log(`\n== ${r.compound} ==`); last = r.compound; }
    console.log(`  ${r.property}`);
  }
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
