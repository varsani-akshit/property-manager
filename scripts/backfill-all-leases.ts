// Runs backfill_lease_rents for every lease (active + ended). Idempotent —
// existing rent rows are preserved; only missing months are filled in.
// Reports before/after row counts per lease so we can see what changed.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  const { rows: leases } = await client.query(`
    select l.id, l.lessee_name, l.start_date, l.end_date, l.active,
           p.name as property_name, c.name as compound
    from public.leases l
    join public.properties p on p.id = l.property_id
    left join public.compounds c on c.id = p.compound_id
    order by c.name, p.name
  `);

  console.log(`Found ${leases.length} lease(s). Running backfill for each…\n`);

  let totalAdded = 0;
  let leasesTouched = 0;

  for (const l of leases) {
    const { rows: [before] } = await client.query(
      `select count(*)::int as n from public.rent_collections where lease_id = $1`,
      [l.id]
    );
    const { rows: [{ backfill_lease_rents: added }] } = await client.query(
      `select public.backfill_lease_rents($1)`,
      [l.id]
    );
    const { rows: [after] } = await client.query(
      `select count(*)::int as n from public.rent_collections where lease_id = $1`,
      [l.id]
    );

    const status = l.active ? "active" : "ended";
    const changed = after.n - before.n;
    const marker = changed > 0 ? `+${changed}` : "  ";
    console.log(
      `  ${marker.padStart(4)}   ${(l.compound || "—").padEnd(30)}  ` +
      `${(l.property_name || "?").padEnd(28)}  ` +
      `${(l.lessee_name || "?").padEnd(28)}  ` +
      `${l.start_date} → ${l.end_date}  ` +
      `[${status}]  ` +
      `${before.n} → ${after.n} rows`
    );

    if (changed > 0) {
      totalAdded += changed;
      leasesTouched += 1;
    }
  }

  console.log(`\nDone. Added ${totalAdded} rent rows across ${leasesTouched} lease(s).`);
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
