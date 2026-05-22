import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { money } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CompoundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const profile = await guardView("view_compounds");
  const sb = await supabaseServer();

  const { data: compound } = await sb.from("compounds").select("*").eq("id", id).maybeSingle();
  if (!compound) notFound();

  const [pageRes, allRes] = await Promise.all([
    sb.from("v_property_summary").select("*", { count: "exact" }).eq("compound_id", id).range(from, to),
    sb.from("v_property_summary").select("valuation, area_sqft, total_rent_collected, total_costs").eq("compound_id", id),
  ]);

  const arr = pageRes.data ?? [];
  const total = pageRes.count ?? 0;
  const all = allRes.data ?? [];
  const totalValuation = all.reduce((s, p) => s + Number((p as any).valuation || 0), 0);
  const totalSqft = all.reduce((s, p) => s + Number((p as any).area_sqft || 0), 0);
  const totalCollected = all.reduce((s, p) => s + Number((p as any).total_rent_collected || 0), 0);
  const totalCosts = all.reduce((s, p) => s + Number((p as any).total_costs || 0), 0);

  return (
    <div>
      <PageHeader
        title={compound.name}
        subtitle={compound.address || undefined}
        actions={has(profile, "edit_property") ? <Link href={`/compounds/${id}/edit`} className="btn-secondary">Edit</Link> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(total)} />
        <Kpi label="Total sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Total valuation" value={money(totalValuation)} />
        <Kpi label="Net" value={money(totalCollected - totalCosts)} />
      </div>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Property</th>
              <th className="text-right">Sqft</th>
              <th className="text-right">Valuation</th>
              <th className="text-right">Rent collected</th>
              <th className="text-right">Costs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((p) => (
              <tr key={(p as any).id}>
                <td><Link href={`/properties/${(p as any).id}`} className="font-medium hover:underline">{(p as any).name}</Link></td>
                <td className="text-right">{Number((p as any).area_sqft).toLocaleString()}</td>
                <td className="text-right">{money((p as any).valuation)}</td>
                <td className="text-right">{money((p as any).total_rent_collected)}</td>
                <td className="text-right">{money((p as any).total_costs)}</td>
                <td>{Number((p as any).active_lease_count) > 0 ? <span className="badge-success">Rented</span> : <span className="badge-muted">Vacant</span>}</td>
              </tr>
            ))}
            {!arr.length && <tr><td colSpan={6} className="text-center text-muted-fg py-8">No properties in this compound yet.</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} total={total} label="properties" />
      </div>
    </div>
  );
}
