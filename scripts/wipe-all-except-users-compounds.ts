// Hard wipe: deletes everything except user_profiles, compounds, and cost_categories.
// Use only when starting fresh from a real-data import.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // Run in a transaction so it's all-or-nothing.
  await client.query("begin");
  try {
    // Delete in FK-safe order. Most are ON DELETE CASCADE from costs/leases/properties
    // but deleting explicitly keeps things obvious.
    const r1 = await client.query("delete from public.rent_collections");
    const r2 = await client.query("delete from public.leases");
    const r3 = await client.query("delete from public.service_charges");
    const r4 = await client.query("delete from public.cost_allocations");
    const r5 = await client.query("delete from public.cost_line_items");
    const r6 = await client.query("delete from public.costs");
    const r7 = await client.query("delete from public.properties");

    await client.query("commit");

    console.log("Deleted:");
    console.table([
      { table: "rent_collections",  rows: r1.rowCount ?? 0 },
      { table: "leases",            rows: r2.rowCount ?? 0 },
      { table: "service_charges",   rows: r3.rowCount ?? 0 },
      { table: "cost_allocations",  rows: r4.rowCount ?? 0 },
      { table: "cost_line_items",   rows: r5.rowCount ?? 0 },
      { table: "costs",             rows: r6.rowCount ?? 0 },
      { table: "properties",        rows: r7.rowCount ?? 0 },
    ]);

    const remaining = await client.query(`
      select 'user_profiles' as table, count(*)::int as rows from public.user_profiles
      union all select 'compounds',           count(*)::int from public.compounds
      union all select 'cost_categories',     count(*)::int from public.cost_categories
      union all select 'properties',          count(*)::int from public.properties
      union all select 'leases',              count(*)::int from public.leases
      union all select 'rent_collections',    count(*)::int from public.rent_collections
      union all select 'costs',               count(*)::int from public.costs
      union all select 'service_charges',     count(*)::int from public.service_charges
    `);
    console.log("\nRemaining row counts:");
    console.table(remaining.rows);
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
