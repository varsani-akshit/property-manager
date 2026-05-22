import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  const jobs = await client.query("select jobid, jobname, schedule, command, active from cron.job order by jobname");
  console.log("Scheduled cron jobs:");
  console.table(jobs.rows);

  // Recent runs (last 10)
  const runs = await client.query(`
    select j.jobname, r.start_time, r.end_time, r.status, r.return_message
    from cron.job_run_details r
    join cron.job j on j.jobid = r.jobid
    order by r.start_time desc
    limit 10
  `);
  console.log("\nRecent runs:");
  console.table(runs.rows);
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
