// Lists all properties (with compound + active lessee) so we can identify
// which ones are demo entries to remove.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  const { rows } = await client.query(`
    select p.id,
           p.name,
           c.name  as compound,
           p.archived,
           l.lessee_name as active_lessee,
           p.created_at
    from public.properties p
    left join public.compounds c on c.id = p.compound_id
    left join public.leases l on l.property_id = p.id and l.active = true
    order by p.created_at desc, p.name
  `);
  console.log(`Total properties: ${rows.length}\n`);
  console.log("id                                   | compound / property                                  | lessee                     | archived | created");
  console.log("-".repeat(180));
  for (const r of rows) {
    const line = [
      r.id,
      `${(r.compound ?? "—").padEnd(20)} / ${(r.name ?? "?").padEnd(28)}`,
      (r.active_lessee ?? "(vacant)").padEnd(26),
      r.archived ? "YES" : "no ",
      new Date(r.created_at).toISOString().slice(0, 10),
    ].join(" | ");
    console.log(line);
  }
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
