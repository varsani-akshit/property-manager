import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { money } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile, has } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function CompoundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();
  const { data: compound } = await sb.from("compounds").select("*").eq("id", id).maybeSingle();
  if (!compound) notFound();

  const { data: props } = await sb
    .from("v_property_summary")
    .select("*")
    .eq("compound_id", id);

  const arr = props ?? [];
  const totalValuation = arr.reduce((s, p: any) => s + Number(p.valuation || 0), 0);
  const totalSqft = arr.reduce((s, p: any) => s + Number(p.area_sqft || 0), 0);
  const totalCollected = arr.reduce((s, p: any) => s + Number(p.total_rent_collected || 0), 0);
  const totalCosts = arr.reduce((s, p: any) => s + Number(p.total_costs || 0), 0);

  return (
    <div>
      <PageHeader
        title={compound.name}
        subtitle={compound.address || undefined}
        actions={has(profile, "edit_property") ? <Link href={`/compounds/${id}/edit`} className="btn-secondary">Edit</Link> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(arr.length)} />
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
            {arr.map((p: any) => (
              <tr key={p.id}>
                <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                <td className="text-right">{Number(p.area_sqft).toLocaleString()}</td>
                <td className="text-right">{money(p.valuation)}</td>
                <td className="text-right">{money(p.total_rent_collected)}</td>
                <td className="text-right">{money(p.total_costs)}</td>
                <td>{p.active_lease_count > 0 ? <span className="badge-success">Rented</span> : <span className="badge-muted">Vacant</span>}</td>
              </tr>
            ))}
            {!arr.length && <tr><td colSpan={6} className="text-center text-muted-fg py-8">No properties in this compound yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
