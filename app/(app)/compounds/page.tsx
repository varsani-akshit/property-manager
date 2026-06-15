import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { SearchBar } from "@/components/SearchBar";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CompoundsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const profile = await guardView("view_compounds");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();

  let listQ = sb.from("compounds").select("id, name, address, properties(count)", { count: "exact" });
  if (q) listQ = listQ.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
  const [pageRes, summary] = await Promise.all([
    listQ.order("name").range(from, to),
    sb.from("v_property_summary").select("compound_id, valuation, area_sqft, total_rent_collected, total_costs"),
  ]);

  const compounds = pageRes.data ?? [];
  const total = pageRes.count ?? 0;

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

  const totalProps = (summary.data ?? []).length;
  const totalValuation = (summary.data ?? []).reduce((s, r) => s + Number((r as { valuation: number }).valuation || 0), 0);
  const totalSqft = (summary.data ?? []).reduce((s, r) => s + Number((r as { area_sqft: number }).area_sqft || 0), 0);

  return (
    <div>
      <PageHeader
        title="Compounds"
       
        actions={
          has(profile, "create_property") ? (
            <Link href="/compounds/new" className="btn-primary"><Plus size={14} /> New compound</Link>
          ) : null
        }
      />

      <SearchBar placeholder="Search by name or address…" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Compounds" value={String(total)} />
        <Kpi label="Properties" value={String(totalProps)} />
        <Kpi label="Portfolio sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Portfolio valuation" value={money(totalValuation)} />
      </div>

      <div className="card p-0">
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Name</th><th>Address</th>
              <th className="text-right">Properties</th>
              <th className="text-right">Valuation</th>
              <th className="text-right">Net (collected − costs)</th>
            </tr>
          </thead>
          <tbody>
            {compounds.map((c) => {
              const s = byCompound[c.id] ?? { valuation: 0, sqft: 0, collected: 0, costs: 0, count: 0 };
              return (
                <tr key={c.id} className="cursor-pointer">
                  <td><Link href={`/compounds/${c.id}`} className="block font-medium">{c.name}</Link></td>
                  <td><Link href={`/compounds/${c.id}`} className="block text-muted-fg">{c.address || "—"}</Link></td>
                  <td className="text-right"><Link href={`/compounds/${c.id}`} className="block">{c.properties?.[0]?.count ?? 0}</Link></td>
                  <td className="text-right"><Link href={`/compounds/${c.id}`} className="block">{money(s.valuation)}</Link></td>
                  <td className="text-right"><Link href={`/compounds/${c.id}`} className="block">{money(s.collected - s.costs)}</Link></td>
                </tr>
              );
            })}
            {!compounds.length && (
              <tr><td colSpan={5} className="text-center text-muted-fg py-8">No compounds yet.</td></tr>
            )}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} label="compounds" searchParams={sp} />
      </div>
    </div>
  );
}
