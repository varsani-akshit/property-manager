import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CompoundsPage() {
  const profile = await guardView("view_compounds");
  const sb = await supabaseServer();

  const [{ data: compounds }, { data: summary }] = await Promise.all([
    sb.from("compounds").select("id, name, address, properties(count)").order("name"),
    sb.from("v_property_summary").select("compound_id, valuation, area_sqft, total_rent_collected, total_costs"),
  ]);

  const byCompound: Record<string, { valuation: number; sqft: number; collected: number; costs: number; count: number }> = {};
  for (const p of summary ?? []) {
    const k = (p as { compound_id: string }).compound_id;
    byCompound[k] ??= { valuation: 0, sqft: 0, collected: 0, costs: 0, count: 0 };
    const row = p as { compound_id: string; valuation: number; area_sqft: number; total_rent_collected: number; total_costs: number };
    byCompound[k].valuation += Number(row.valuation || 0);
    byCompound[k].sqft += Number(row.area_sqft || 0);
    byCompound[k].collected += Number(row.total_rent_collected || 0);
    byCompound[k].costs += Number(row.total_costs || 0);
    byCompound[k].count += 1;
  }

  const totalProps = (summary ?? []).length;
  const totalValuation = (summary ?? []).reduce((s: number, r) => s + Number((r as { valuation: number }).valuation || 0), 0);
  const totalSqft = (summary ?? []).reduce((s: number, r) => s + Number((r as { area_sqft: number }).area_sqft || 0), 0);

  return (
    <div>
      <PageHeader
        title="Compounds"
        subtitle="Areas / buildings that group your properties"
        actions={
          has(profile, "create_property") ? (
            <Link href="/compounds/new" className="btn-primary"><Plus size={14} /> New compound</Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Compounds" value={String(compounds?.length ?? 0)} />
        <Kpi label="Properties" value={String(totalProps)} />
        <Kpi label="Portfolio sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Portfolio valuation" value={money(totalValuation)} />
      </div>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th><th>Address</th>
              <th className="text-right">Properties</th>
              <th className="text-right">Valuation</th>
              <th className="text-right">Net (collected − costs)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {compounds?.map((c) => {
              const s = byCompound[c.id] ?? { valuation: 0, sqft: 0, collected: 0, costs: 0, count: 0 };
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/compounds/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  </td>
                  <td className="text-muted-fg">{c.address || "—"}</td>
                  <td className="text-right">{c.properties?.[0]?.count ?? 0}</td>
                  <td className="text-right">{money(s.valuation)}</td>
                  <td className="text-right">{money(s.collected - s.costs)}</td>
                  <td className="text-right">
                    {has(profile, "edit_property") && (
                      <Link href={`/compounds/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {!compounds?.length && (
              <tr><td colSpan={6} className="text-center text-muted-fg py-8">No compounds yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
