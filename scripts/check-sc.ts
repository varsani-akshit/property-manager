import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  const jobs = await client.query("select jobid, jobname, schedule, active from cron.job order by jobname");
  console.log("Cron jobs:");
  console.table(jobs.rows);

  const status = await client.query(`
    select status, count(*) as rows, sum(amount)::numeric(14,2) as total
    from public.service_charges
    group by status
    order by status
  `);
  console.log("\nservice_charges by status:");
  console.table(status.rows);

  const byMonth = await client.query(`
    select to_char(due_month, 'YYYY-MM') as month, status, count(*) as rows
    from public.service_charges
    group by month, status
    order by month, status
  `);
  console.log("\nservice_charges by month + status:");
  console.table(byMonth.rows);

  const oldCosts = await client.query("select count(*)::int as remaining from public.costs where category = 'service_charge'");
  console.log("\nremaining service_charge costs (should be 0):", oldCosts.rows[0].remaining);

  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
