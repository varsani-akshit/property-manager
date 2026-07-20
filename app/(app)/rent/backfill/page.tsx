import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { SearchBar } from "@/components/SearchBar";
import { Kpi } from "@/components/Kpi";
import { guardView } from "@/lib/guard";
import { BackfillIndexTable, type IndexRow } from "./BackfillIndexTable";

export const dynamic = "force-dynamic";

export default async function BackfillIndex({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await guardView("view_rent");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";

  const sb = await supabaseServer();

  const [{ data: propsData }, { data: rentCounts }, { data: activeLeases }] = await Promise.all([
    sb.from("properties").select("id, name, compounds(name)").eq("archived", false),
    // View: SELECT property_id, count(*) FROM rent_collections GROUP BY property_id.
    // Avoids pulling every rent row just to count per property.
    sb.from("v_rent_rows_by_property").select("property_id, row_count"),
    sb.from("leases").select("property_id, lessee_name").eq("active", true),
  ]);

  const countByProp = new Map<string, number>();
  for (const r of rentCounts ?? []) {
    const row = r as { property_id: string; row_count: number };
    countByProp.set(row.property_id, Number(row.row_count));
  }
  const lesseeByProp = new Map<string, string>();
  for (const l of activeLeases ?? []) {
    lesseeByProp.set((l as { property_id: string }).property_id, (l as { lessee_name: string }).lessee_name);
  }

  let rows: IndexRow[] = (propsData ?? []).map((p: any) => {
    const c = Array.isArray(p.compounds) ? p.compounds[0] : p.compounds;
    return {
      id: p.id,
      property_name: p.name,
      compound_name: c?.name ?? "—",
      active_lessee: lesseeByProp.get(p.id) ?? null,
      rent_row_count: countByProp.get(p.id) ?? 0,
    };
  });

  if (q) {
    rows = rows.filter((r) =>
      r.property_name.toLowerCase().includes(q) ||
      r.compound_name.toLowerCase().includes(q) ||
      (r.active_lessee?.toLowerCase().includes(q) ?? false)
    );
  }

  // Summary numbers reflect the WHOLE dataset, not the search filter.
  const allRowCount = Array.from(countByProp.values()).reduce((a, b) => a + b, 0);
  const propertiesWithRent = countByProp.size;
  const totalProperties = propsData?.length ?? 0;
  const rentedProperties = lesseeByProp.size;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Rent Collection", href: "/rent" }, { label: "Backfill" }]}
        right={<SearchBar placeholder="Search property, compound, lessee…" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(totalProperties)} hint={`${rentedProperties} rented`} />
        <Kpi label="With rent rows" value={String(propertiesWithRent)} />
        <Kpi label="Total rent rows" value={allRowCount.toLocaleString()} />
        <Kpi label="Matching filter" value={String(rows.length)} />
      </div>

      <BackfillIndexTable rows={rows} />
    </div>
  );
}
