// Demo data seeder: creates 6 DEMO leases on randomly-picked existing properties
// and generates rent_collections rows across all 3 buckets (overdue, due soon, collected).
// Idempotent: deletes any prior DEMO-tagged data first.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const TODAY = new Date();
const todayISO = TODAY.toISOString().slice(0, 10);

function isoDate(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function monthStartISO(y: number, m: number): string {
  return isoDate(y, m, 1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // 0) Wipe any previous demo data
  await client.query(`
    delete from public.rent_collections rc
    using public.leases l
    where rc.lease_id = l.id and l.lessee_name like 'DEMO —%'
  `);
  await client.query(`delete from public.leases where lessee_name like 'DEMO —%'`);

  // 1) Pick 6 properties — prefer ones with SC=0 for cleaner demo math; fall back if not enough.
  const { rows: props } = await client.query(`
    (select id, name from public.properties
       where archived = false and service_charge_monthly = 0
         and not exists (select 1 from public.leases l where l.property_id = properties.id and l.active = true)
       order by random() limit 6)
    union all
    (select id, name from public.properties
       where archived = false
         and not exists (select 1 from public.leases l where l.property_id = properties.id and l.active = true)
       order by random() limit 6)
    limit 6
  `);

  if (props.length < 6) {
    throw new Error(`Need at least 6 vacant properties; got ${props.length}`);
  }

  // Today is 2026-05-22 per current data. Each lease has:
  //   - start date in the past so we have history,
  //   - a due_day that lands the May payment into the desired bucket.
  // For "we_pay" mode with SC=0, gross = net (no deduction).
  type Plan = {
    prop_idx: number;
    lessee: string;
    contact: string;
    start: { y: number; m: number; d: number };
    end:   { y: number; m: number; d: number };
    rent:  number;
    // Each historical-month entry will become a row in rent_collections
    history: Array<{ y: number; m: number; status: "collected" | "due" }>; // status of past months
  };

  const plans: Plan[] = [
    // Lease A — due 5th, May 5 is overdue, multiple months collected
    { prop_idx: 0, lessee: "DEMO — Acme Holdings Ltd",     contact: "+254 700 100 001",
      start: { y: 2026, m: 1, d: 5 }, end: { y: 2027, m: 12, d: 31 }, rent: 80000,
      history: [
        { y: 2026, m: 1, status: "collected" },
        { y: 2026, m: 2, status: "collected" },
        { y: 2026, m: 3, status: "collected" },
        { y: 2026, m: 4, status: "collected" },
        { y: 2026, m: 5, status: "due" }, // overdue (May 5)
      ],
    },
    // Lease B — due 15th, May 15 overdue
    { prop_idx: 1, lessee: "DEMO — Bluebird Logistics",    contact: "bluebird@example.co.ke",
      start: { y: 2026, m: 2, d: 15 }, end: { y: 2028, m: 6, d: 30 }, rent: 120000,
      history: [
        { y: 2026, m: 2, status: "collected" },
        { y: 2026, m: 3, status: "collected" },
        { y: 2026, m: 4, status: "collected" },
        { y: 2026, m: 5, status: "due" }, // overdue (May 15)
      ],
    },
    // Lease C — due 25th, May 25 falls in due-soon window (3 days away)
    { prop_idx: 2, lessee: "DEMO — Catalyst Travels",      contact: "+254 720 555 003",
      start: { y: 2025, m: 12, d: 25 }, end: { y: 2027, m: 12, d: 31 }, rent: 150000,
      history: [
        { y: 2025, m: 12, status: "collected" },
        { y: 2026, m: 1,  status: "collected" },
        { y: 2026, m: 2,  status: "collected" },
        { y: 2026, m: 3,  status: "collected" },
        { y: 2026, m: 4,  status: "collected" },
        { y: 2026, m: 5,  status: "due" }, // due soon (May 25)
      ],
    },
    // Lease D — due 23rd, May 23 due-soon (1 day away)
    { prop_idx: 3, lessee: "DEMO — Drexton Kenya",         contact: "drexton.ke@example.com",
      start: { y: 2026, m: 4, d: 23 }, end: { y: 2027, m: 4, d: 22 }, rent: 95000,
      history: [
        { y: 2026, m: 4, status: "collected" },
        { y: 2026, m: 5, status: "due" }, // due soon (May 23)
      ],
    },
    // Lease E — due 28th, May 28 due-soon (6 days away)
    { prop_idx: 4, lessee: "DEMO — Efficaxx Consultants",  contact: "+254 733 800 005",
      start: { y: 2026, m: 1, d: 28 }, end: { y: 2027, m: 12, d: 31 }, rent: 70000,
      history: [
        { y: 2026, m: 1, status: "collected" },
        { y: 2026, m: 2, status: "collected" },
        { y: 2026, m: 3, status: "collected" },
        { y: 2026, m: 4, status: "collected" },
        { y: 2026, m: 5, status: "due" }, // due soon (May 28)
      ],
    },
    // Lease F — due 15th, May 15 overdue (third overdue)
    { prop_idx: 5, lessee: "DEMO — Faraja Traders Ltd",    contact: "faraja@example.org",
      start: { y: 2026, m: 3, d: 15 }, end: { y: 2027, m: 9, d: 30 }, rent: 100000,
      history: [
        { y: 2026, m: 3, status: "collected" },
        { y: 2026, m: 4, status: "collected" },
        { y: 2026, m: 5, status: "due" }, // overdue (May 15)
      ],
    },
  ];

  function clampDay(y: number, m: number, day: number): number {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Math.min(day, lastDay);
  }

  for (const plan of plans) {
    const prop = props[plan.prop_idx];
    const startISO = isoDate(plan.start.y, plan.start.m, plan.start.d);
    const endISO   = isoDate(plan.end.y,   plan.end.m,   plan.end.d);

    const { rows: leaseRows } = await client.query(
      `insert into public.leases
         (property_id, lessee_name, lessee_contact, start_date, end_date,
          gross_rent_monthly, sc_payment_mode, lessee_pays_service_charge, active)
       values ($1,$2,$3,$4,$5,$6,'we_pay',true,true)
       returning id`,
      [prop.id, plan.lessee, plan.contact, startISO, endISO, plan.rent]
    );
    const leaseId = leaseRows[0].id;
    const dueDay = plan.start.d;

    // Past months from history
    for (const h of plan.history) {
      const dueDate = isoDate(h.y, h.m, clampDay(h.y, h.m, dueDay));
      const monthStart = monthStartISO(h.y, h.m);
      const collectedAt = h.status === "collected"
        ? new Date(Date.UTC(h.y, h.m - 1, clampDay(h.y, h.m, dueDay + 2))).toISOString()
        : null;
      await client.query(
        `insert into public.rent_collections
           (lease_id, property_id, due_month, due_date, gross_amount,
            service_charge_deduction, net_amount, status, collected_at)
         values ($1,$2,$3,$4,$5,0,$5,$6,$7)
         on conflict (lease_id, due_month) do nothing`,
        [leaseId, prop.id, monthStart, dueDate, plan.rent, h.status, collectedAt]
      );
    }

    // One future month (June) so dashboard "next 30 days" projection has data
    const juneDueDate = isoDate(2026, 6, clampDay(2026, 6, dueDay));
    await client.query(
      `insert into public.rent_collections
         (lease_id, property_id, due_month, due_date, gross_amount,
          service_charge_deduction, net_amount, status)
       values ($1,$2,$3,$4,$5,0,$5,'due')
       on conflict (lease_id, due_month) do nothing`,
      [leaseId, prop.id, "2026-06-01", juneDueDate, plan.rent]
    );

    console.log(`✓ ${plan.lessee} → ${prop.name}`);
  }

  // Final report
  const summary = await client.query(`
    with bucketed as (
      select rc.status,
             case
               when rc.status = 'collected' then 'collected'
               when rc.status = 'due' and rc.due_date <= current_date then 'overdue'
               when rc.status = 'due' and rc.due_date <= current_date + 7 then 'due_soon'
               else 'future'
             end as bucket,
             rc.net_amount
      from public.rent_collections rc
      join public.leases l on l.id = rc.lease_id
      where l.lessee_name like 'DEMO —%'
    )
    select bucket, count(*) as rows, sum(net_amount)::numeric(14,2) as total
    from bucketed
    group by bucket
    order by bucket
  `);
  console.log("\nDemo data summary:");
  console.table(summary.rows);

  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
