import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { SearchBar } from "@/components/SearchBar";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";
import { CompoundsTable, type CompoundRow } from "./CompoundsTable";

export const dynamic = "force-dynamic";

export default async function CompoundsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await guardView("view_compounds");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";

  const sb = await supabaseServer();

  let listQ = sb.from("compounds").select("id, name, address");
  if (q) listQ = listQ.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
  const [listRes, summary] = await Promise.all([
    listQ,
    sb.from("v_property_summary").select("compound_id, valuation, area_sqft, total_rent_collected, total_costs"),
  ]);

  const compounds = listRes.data ?? [];

  const byCompound: Record<string, { valuation: number; sqft: number; collected: number; costs: number; count: number }> = {};
  for (const p of summary.data ?? []) {
    const row = p as { compound_id: string; valuation: number; area_sqft: number; total_rent_collected: number; total_costs: number };
    const k = row.compound_id;
    byCompound[k] ??= { valuation: 0, sqft: 0, collected: 0, costs: 0, count: 0 };
    byCompound[k].valuation += Number(row.valuation || 0);
    byCompound[k].sqft += Number(row.area_sqft || 0);
    byCompound[k].collected += Number(row.total_rent_collected || 0);
    byCompound[k].costs += Number(row.total_costs || 0);
    byCompound[k].count += 1;
  }

  const rows: CompoundRow[] = compounds.map((c: any) => {
    const stats = byCompound[c.id] ?? { valuation: 0, sqft: 0, collected: 0, costs: 0, count: 0 };
    return {
      id: c.id,
      name: c.name,
      address: c.address,
      property_count: stats.count,
      valuation: stats.valuation,
      sqft: stats.sqft,
      collected: stats.collected,
      costs: stats.costs,
    };
  });

  const totalProps = (summary.data ?? []).length;
  const totalValuation = (summary.data ?? []).reduce((s, r) => s + Number((r as { valuation: number }).valuation || 0), 0);
  const totalSqft = (summary.data ?? []).reduce((s, r) => s + Number((r as { area_sqft: number }).area_sqft || 0), 0);

  return (
    <div>
      <PageHeader
        title="Compounds"
        right={<SearchBar placeholder="Search name or address…" />}
        actions={
          has(profile, "create_property") ? (
            <Link href="/compounds/new" className="btn-primary"><Plus size={14} /> New compound</Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Compounds" value={String(rows.length)} />
        <Kpi label="Properties" value={String(totalProps)} />
        <Kpi label="Portfolio sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Portfolio valuation" value={money(totalValuation)} />
      </div>

      <CompoundsTable rows={rows} />
    </div>
  );
}
