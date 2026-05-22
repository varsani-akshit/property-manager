import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

type Prop = {
  compound: string;
  name: string;
  area_sqft: number;
  valuation: number;
  service_charge_monthly: number;
  deed_url: string | null;
};
type Lease = {
  compound: string;
  property_name: string;
  lessee_name: string;
  contact: string | null;
  lessee_doc_url: string | null;
  start_date: string | null;
  end_date: string | null;
  gross_rent_monthly: number;
};

const data = JSON.parse(readFileSync(resolve("scripts/seed_data.json"), "utf8")) as {
  compounds: string[];
  properties: Prop[];
  leases: Lease[];
};

// Normalize compound names: collapse internal whitespace.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // Apply nullability patch (idempotent)
  await client.query(`alter table public.leases alter column lessee_contact drop not null`).catch(() => {});

  // 1) Insert compounds
  const compoundIds: Record<string, string> = {};
  for (const raw of data.compounds) {
    const name = norm(raw);
    const { rows } = await client.query(
      `insert into public.compounds (name) values ($1)
       on conflict do nothing
       returning id`,
      [name]
    );
    let id = rows[0]?.id;
    if (!id) {
      const r = await client.query(`select id from public.compounds where name = $1`, [name]);
      id = r.rows[0]?.id;
    }
    compoundIds[name] = id;
  }
  console.log(`compounds: ${Object.keys(compoundIds).length}`);

  // 2) Insert properties
  let propsInserted = 0;
  const propertyIds: Record<string, string> = {}; // key: `${compound}::${name}`
  for (const p of data.properties) {
    const compoundName = norm(p.compound);
    const compoundId = compoundIds[compoundName];
    if (!compoundId) {
      console.warn(`skip property — no compound: ${p.name}`);
      continue;
    }
    const key = `${compoundName}::${p.name}`;
    // Check if already exists (idempotent)
    const existing = await client.query(
      `select id from public.properties where compound_id = $1 and name = $2 limit 1`,
      [compoundId, p.name]
    );
    if (existing.rows[0]) {
      propertyIds[key] = existing.rows[0].id;
      continue;
    }
    const { rows } = await client.query(
      `insert into public.properties
         (compound_id, name, area_sqft, valuation, service_charge_monthly, deed_url)
       values ($1,$2,$3,$4,$5,$6)
       returning id`,
      [compoundId, p.name, p.area_sqft, p.valuation, p.service_charge_monthly, p.deed_url]
    );
    propertyIds[key] = rows[0].id;
    propsInserted++;
  }
  console.log(`properties inserted: ${propsInserted}`);

  // 3) Insert leases — skip broken-date ones
  let leasesInserted = 0;
  const skipped: string[] = [];
  for (const l of data.leases) {
    const compoundName = norm(l.compound);
    const key = `${compoundName}::${l.property_name}`;
    const propId = propertyIds[key];
    if (!propId) {
      skipped.push(`${l.property_name} — property not found`);
      continue;
    }
    if (!l.start_date || !l.end_date) {
      skipped.push(`${l.property_name} (${l.lessee_name}) — missing start/end date`);
      continue;
    }
    // Skip if there's already an active lease on this property
    const existing = await client.query(
      `select id from public.leases where property_id = $1 and active = true limit 1`,
      [propId]
    );
    if (existing.rows[0]) continue;

    try {
      await client.query(
        `insert into public.leases
           (property_id, lessee_name, lessee_contact, lessee_doc_url,
            start_date, end_date, gross_rent_monthly, lessee_pays_service_charge, active)
         values ($1,$2,$3,$4,$5,$6,$7,false,true)`,
        [propId, l.lessee_name, l.contact, l.lessee_doc_url, l.start_date, l.end_date, l.gross_rent_monthly]
      );
      leasesInserted++;
    } catch (e: any) {
      skipped.push(`${l.property_name} (${l.lessee_name}) — ${e.message}`);
    }
  }
  console.log(`leases inserted: ${leasesInserted}`);
  if (skipped.length) {
    console.log(`\nskipped ${skipped.length} leases:`);
    for (const s of skipped) console.log("  -", s);
  }

  await client.end();
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
