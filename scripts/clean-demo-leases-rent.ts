// Cleans demo leases (and cascading rent_collections) so the app starts blank
// for leases + rent. Leaves properties, compounds, service_charges, costs alone.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const DEMO_LESSEES = [
  "Acme Holdings Ltd",
  "Bluebird Logistics",
  "Catalyst Travels",
  "Drexton Kenya",
  "Efficaxx Consultants",
  "Faraja Traders Ltd",
];

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // Just to be safe, also wipe any rent rows whose lease was already deleted (orphans).
  const r1 = await client.query(
    `delete from public.rent_collections
     where lease_id in (
       select id from public.leases
       where lessee_name = any($1) or lessee_name like 'DEMO —%'
     )`,
    [DEMO_LESSEES]
  );

  const r2 = await client.query(
    `delete from public.leases
     where lessee_name = any($1) or lessee_name like 'DEMO —%'`,
    [DEMO_LESSEES]
  );

  // Verify
  const [{ rows: leases }, { rows: rents }, { rows: props }] = await Promise.all([
    client.query("select count(*)::int as n from public.leases"),
    client.query("select count(*)::int as n from public.rent_collections"),
    client.query("select count(*)::int as n from public.properties"),
  ]);

  console.log(`Deleted: ${r1.rowCount ?? 0} rent_collections, ${r2.rowCount ?? 0} leases`);
  console.log(`Remaining → leases: ${leases[0].n}, rent_collections: ${rents[0].n}, properties: ${props[0].n}`);
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
