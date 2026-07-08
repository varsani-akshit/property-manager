// One-off: delete the demo/test properties left over from initial setup.
// These are already archived and vacant — safe to remove permanently.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const IDS_TO_DELETE = [
  "4bd1432f-9a90-4301-8aa1-7263c558a353", // "sadf" (archived, vacant)
  "c1e95ffa-5269-4556-be9c-998ef9d59ca9", // "sadf" (archived, vacant)
  "f61bc54e-f14b-47a4-8b67-5f892e9f50d8", // "Godown No. 0" (archived, vacant)
];

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // Show what we're about to delete
  const { rows: preview } = await client.query(
    `select id, name, archived,
            (select count(*) from public.leases where property_id = p.id) as lease_count,
            (select count(*) from public.rent_collections where property_id = p.id) as rent_count,
            (select count(*) from public.cost_allocations where property_id = p.id) as cost_count,
            (select count(*) from public.service_charges where property_id = p.id) as sc_count
     from public.properties p
     where id = any($1)`,
    [IDS_TO_DELETE]
  );
  console.log("About to delete:");
  for (const p of preview) {
    console.log(`  ${p.name} — leases=${p.lease_count}, rent=${p.rent_count}, costs=${p.cost_count}, sc=${p.sc_count}`);
  }

  // FK cascades cover leases → rent_collections; cost_allocations, service_charges
  // all cascade from properties. Trigger a single DELETE.
  const { rowCount } = await client.query(
    `delete from public.properties where id = any($1)`,
    [IDS_TO_DELETE]
  );
  console.log(`\nDeleted ${rowCount} properties.`);

  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
