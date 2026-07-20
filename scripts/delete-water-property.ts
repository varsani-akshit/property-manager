// Remove the stray "Water" property (used as a workaround for utility
// tracking). Utilities now belong as lessee-billed costs under a real
// property, so this standalone Water property is no longer needed.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  const { rows: props } = await client.query(`
    select p.id, p.name, c.id as compound_id, c.name as compound_name,
           (select count(*) from public.leases where property_id = p.id) as lease_count,
           (select count(*) from public.rent_collections where property_id = p.id) as rent_count,
           (select count(*) from public.cost_allocations where property_id = p.id) as cost_count,
           (select count(*) from public.service_charges where property_id = p.id) as sc_count
    from public.properties p
    left join public.compounds c on c.id = p.compound_id
    where lower(p.name) = 'water' or lower(c.name) = 'water'
  `);

  if (!props.length) {
    console.log("No 'Water' property found. Nothing to do.");
    await client.end();
    return;
  }

  console.log("Found:");
  for (const p of props) {
    console.log(`  compound="${p.compound_name}" · property="${p.name}"`);
    console.log(`    leases=${p.lease_count}, rent=${p.rent_count}, costs=${p.cost_count}, sc=${p.sc_count}`);
  }

  const propertyIds = props.map((p: any) => p.id);
  const compoundIds = [...new Set(props.map((p: any) => p.compound_id).filter(Boolean))];

  // Delete properties (cascades to leases → rent_collections; and cost_allocations, service_charges).
  const { rowCount: deletedProps } = await client.query(
    `delete from public.properties where id = any($1)`,
    [propertyIds]
  );
  console.log(`\nDeleted ${deletedProps} properties.`);

  // Delete compounds that are now empty and named 'water'.
  for (const cid of compoundIds) {
    const { rows: [{ n }] } = await client.query(
      `select count(*)::int as n from public.properties where compound_id = $1`,
      [cid]
    );
    if (n === 0) {
      const { rowCount } = await client.query(
        `delete from public.compounds where id = $1 and lower(name) = 'water'`,
        [cid]
      );
      if (rowCount) console.log(`Deleted empty "Water" compound (${cid}).`);
    } else {
      console.log(`Compound ${cid} still has ${n} property(ies) — kept.`);
    }
  }

  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
