// Cost seeder: creates ~30 realistic-looking costs across past months for demo.
// Costs are tagged with a "[demo]" marker in the description for safe re-seeding.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const DEMO_TAG = "[demo]";
const TODAY = new Date();

function isoDate(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

type CostSpec = {
  description: string;
  date: string;
  category: string; // legacy column; first line item category mirrors this
  lines: { category: string; amount: number }[]; // line items
  // Allocation: either compound name (all its properties) or specific property name
  scope: { kind: "compound"; compoundName: string } | { kind: "property"; propertyName: string };
};

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // 0) Wipe any prior demo costs (cascade allocations + line items)
  const wiped = await client.query(
    `delete from public.costs where description like '%${DEMO_TAG}%' returning id`
  );
  console.log(`Wiped ${wiped.rowCount ?? 0} previous demo cost rows.`);

  // 1) Fetch compounds and properties for resolving scopes
  const { rows: compounds } = await client.query(
    `select id, name from public.compounds`
  );
  const compoundIdByName = new Map<string, string>(compounds.map((c) => [c.name as string, c.id as string]));

  const { rows: properties } = await client.query(
    `select p.id, p.name, p.compound_id, p.area_sqft, c.name as compound_name
     from public.properties p
     join public.compounds c on c.id = p.compound_id
     where p.archived = false`
  );

  // Build helpers
  const propsByCompoundName = new Map<string, typeof properties>();
  const propsByName = new Map<string, typeof properties[number]>();
  for (const p of properties) {
    propsByName.set(p.name, p);
    const arr = propsByCompoundName.get(p.compound_name) ?? [];
    arr.push(p);
    propsByCompoundName.set(p.compound_name, arr);
  }

  // Find a compound that exists for each given candidate name (case/space tolerant)
  const compoundNames = Array.from(propsByCompoundName.keys());
  function findCompound(prefix: string): string | null {
    const hit = compoundNames.find((n) => n.toLowerCase().includes(prefix.toLowerCase()));
    return hit ?? null;
  }

  // Find a property by partial name within a compound (fallback to any)
  function findPropertyIn(compoundHint: string, propPrefix: string): string | null {
    const compoundName = findCompound(compoundHint);
    if (!compoundName) return null;
    const list = propsByCompoundName.get(compoundName) ?? [];
    const hit = list.find((p) => p.name.toLowerCase().includes(propPrefix.toLowerCase()));
    return hit?.name ?? list[0]?.name ?? null;
  }

  // 2) Build cost specs — realistic for a Kenyan property portfolio
  const specs: CostSpec[] = [];

  // Monthly common-area cleaning per compound (Jan-May)
  for (let m = 1; m <= 5; m++) {
    for (const compoundName of compoundNames) {
      // Skip 0-property compounds (shouldn't exist) and skip ones where the seed didn't land
      const props = propsByCompoundName.get(compoundName) ?? [];
      if (!props.length) continue;
      specs.push({
        description: `Common-area cleaning ${DEMO_TAG} ${monthShort(m)} 2026 — ${compoundName}`,
        date: isoDate(2026, m, 5),
        category: "cleaning",
        lines: [{ category: "cleaning", amount: 12000 + props.length * 800 }],
        scope: { kind: "compound", compoundName },
      });
    }
  }

  // Security services — godown compound (heavy security)
  const godownCompound = findCompound("Godown 12715/565");
  if (godownCompound) {
    for (let m = 1; m <= 5; m++) {
      specs.push({
        description: `Security services ${DEMO_TAG} ${monthShort(m)} 2026`,
        date: isoDate(2026, m, 7),
        category: "security",
        lines: [{ category: "security", amount: 85000 }],
        scope: { kind: "compound", compoundName: godownCompound },
      });
    }
  }

  // Quarterly multi-category maintenance — January & April
  for (const m of [1, 4]) {
    for (const compoundName of compoundNames.slice(0, 4)) {
      specs.push({
        description: `Quarterly maintenance ${DEMO_TAG} ${monthShort(m)} 2026 — ${compoundName}`,
        date: isoDate(2026, m, 15),
        category: "maintenance",
        lines: [
          { category: "plumbing", amount: 18000 },
          { category: "electrical", amount: 22000 },
          { category: "carpentry", amount: 9000 },
          { category: "painting", amount: 7000 },
        ],
        scope: { kind: "compound", compoundName },
      });
    }
  }

  // One-off repairs for specific properties (the demo-leased ones)
  const oneOff: Array<{ compoundHint: string; propHint: string; desc: string; cat: string; amount: number; date: string }> = [
    { compoundHint: "LR No.12715/4470-94", propHint: "Open Space",       desc: "Drainage repair after rains",       cat: "repair",       amount: 38000, date: isoDate(2026, 2, 18) },
    { compoundHint: "Muthaiga Square Showroom", propHint: "Showroom No.12 B", desc: "Roller-shutter motor replacement", cat: "repair",       amount: 52000, date: isoDate(2026, 3, 4)  },
    { compoundHint: "Muthaiga Square Showroom", propHint: "Showroom No.12 A", desc: "Glass facade resealing",         cat: "repair",       amount: 22000, date: isoDate(2026, 4, 11) },
    { compoundHint: "Godown 12715/565",      propHint: "Godown No. 21",   desc: "Forklift access ramp repair",        cat: "repair",       amount: 28000, date: isoDate(2026, 1, 22) },
    { compoundHint: "Muthaiga Square Offices", propHint: "Office No.13",  desc: "Office partitioning works",          cat: "renovation",   amount: 95000, date: isoDate(2026, 2, 9)  },
    { compoundHint: "Mayfair Office Suites", propHint: "Store",           desc: "Pest control treatment",             cat: "pest-control", amount: 8500,  date: isoDate(2026, 3, 28) },
  ];

  for (const o of oneOff) {
    const propName = findPropertyIn(o.compoundHint, o.propHint);
    if (!propName) continue;
    specs.push({
      description: `${o.desc} ${DEMO_TAG}`,
      date: o.date,
      category: o.cat,
      lines: [{ category: o.cat, amount: o.amount }],
      scope: { kind: "property", propertyName: propName },
    });
  }

  // Annual property tax — March, multi-property by compound
  for (const compoundName of compoundNames.slice(0, 3)) {
    specs.push({
      description: `Annual property tax ${DEMO_TAG} FY2026 — ${compoundName}`,
      date: isoDate(2026, 3, 25),
      category: "tax",
      lines: [{ category: "tax", amount: 180000 }],
      scope: { kind: "compound", compoundName },
    });
  }

  // Building insurance — January
  for (const compoundName of compoundNames.slice(0, 4)) {
    specs.push({
      description: `Building insurance premium ${DEMO_TAG} 2026 — ${compoundName}`,
      date: isoDate(2026, 1, 20),
      category: "insurance",
      lines: [{ category: "insurance", amount: 65000 }],
      scope: { kind: "compound", compoundName },
    });
  }

  // Utilities — monthly compound-wide
  for (let m = 1; m <= 5; m++) {
    for (const compoundName of compoundNames.slice(0, 3)) {
      specs.push({
        description: `Electricity & water ${DEMO_TAG} ${monthShort(m)} 2026 — ${compoundName}`,
        date: isoDate(2026, m, 12),
        category: "utilities",
        lines: [
          { category: "electricity", amount: 18000 + m * 500 },
          { category: "water", amount: 6000 + m * 200 },
        ],
        scope: { kind: "compound", compoundName },
      });
    }
  }

  // 3) Insert all specs
  let inserted = 0;
  const categoriesSeen = new Set<string>();
  for (const spec of specs) {
    for (const li of spec.lines) categoriesSeen.add(li.category);

    // Resolve target property IDs
    let propIds: string[] = [];
    if (spec.scope.kind === "compound") {
      const list = propsByCompoundName.get(spec.scope.compoundName) ?? [];
      propIds = list.map((p) => p.id);
    } else {
      const p = propsByName.get(spec.scope.propertyName);
      if (p) propIds = [p.id];
    }
    if (!propIds.length) continue;

    const total = spec.lines.reduce((s, l) => s + l.amount, 0);

    const costRow = await client.query(
      `insert into public.costs (description, category, amount, incurred_on, is_auto_service_charge)
       values ($1, $2, $3, $4, false)
       returning id`,
      [spec.description, spec.lines[0].category, total, spec.date]
    );
    const costId = costRow.rows[0].id;

    // Line items
    for (const li of spec.lines) {
      await client.query(
        `insert into public.cost_line_items (cost_id, category, amount)
         values ($1, $2, $3)`,
        [costId, li.category, li.amount]
      );
    }

    // Allocate
    if (propIds.length === 1) {
      await client.query(
        `insert into public.cost_allocations (cost_id, property_id, allocated_amount)
         values ($1, $2, $3)`,
        [costId, propIds[0], total]
      );
    } else {
      await client.query(`select public.allocate_cost_by_sqft($1, $2::uuid[])`, [costId, propIds]);
    }
    inserted++;
  }

  // Ensure all used categories exist in the lookup table
  for (const cat of categoriesSeen) {
    await client.query(
      `insert into public.cost_categories (name) values ($1) on conflict do nothing`,
      [cat]
    );
  }

  console.log(`✓ Inserted ${inserted} demo cost rows across ${categoriesSeen.size} categories.`);

  // Summary
  const summary = await client.query(`
    select to_char(incurred_on, 'YYYY-MM') as month,
           count(*) as rows,
           sum(amount)::numeric(14,2) as total
    from public.costs
    where description like '%${DEMO_TAG}%'
    group by month
    order by month
  `);
  console.log("\nDemo costs by month:");
  console.table(summary.rows);

  const byCat = await client.query(`
    select li.category, count(*) as line_items, sum(li.amount)::numeric(14,2) as total
    from public.cost_line_items li
    join public.costs c on c.id = li.cost_id
    where c.description like '%${DEMO_TAG}%'
    group by li.category
    order by total desc
  `);
  console.log("\nBy category:");
  console.table(byCat.rows);

  await client.end();
})().catch((e) => { console.error("seed-costs failed:", e.message); process.exit(1); });

function monthShort(m: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
}
