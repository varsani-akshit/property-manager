import { config } from "dotenv";
import { Client } from "pg";
config({ path: ".env" });
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const { rows: views } = await c.query(`
    select viewname from pg_views
    where schemaname = 'public'
      and viewname in ('v_rent_rows_by_property', 'v_sc_status_totals')
    order by viewname
  `);
  console.log("Views installed:");
  for (const v of views) console.log("  ✓", v.viewname);

  const { rows: idx } = await c.query(`
    select indexname from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_rent_property_status','idx_rent_lease_status',
        'idx_rent_due_date','idx_rent_collected_at',
        'idx_sc_status','idx_sc_property_status',
        'idx_costs_lease_status',
        'idx_cost_alloc_prop','idx_cost_alloc_cost',
        'idx_leases_property_active'
      )
    order by indexname
  `);
  console.log(`\nIndexes installed (${idx.length}/10):`);
  for (const i of idx) console.log("  ✓", i.indexname);

  const { rows: sample } = await c.query(`select count(*)::int as n from public.v_rent_rows_by_property`);
  console.log(`\nv_rent_rows_by_property has ${sample[0].n} rows (one per property with rent history)`);

  const { rows: sc } = await c.query(`select * from public.v_sc_status_totals order by status`);
  console.log("\nv_sc_status_totals:");
  for (const s of sc) console.log(`  ${s.status.padEnd(15)} rows=${s.row_count}  sum=${s.amount_sum}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
