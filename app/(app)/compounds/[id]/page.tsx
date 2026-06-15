import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { money } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

export default async function CompoundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; range?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const days = periodDays(period);
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const profile = await guardView("view_compounds");
  const sb = await supabaseServer();

  const { data: compound } = await sb.from("compounds").select("*").eq("id", id).maybeSingle();
  if (!compound) notFound();

  async function deleteCompoundAction() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    const { count } = await sb.from("properties").select("id", { count: "exact", head: true }).eq("compound_id", id);
    if ((count ?? 0) > 0) throw new Error("Compound is not empty");
    const { error } = await sb.from("compounds").delete().eq("id", id);
    if (error) throw new Error(error.message);
    redirect("/compounds");
  }

  // Get the IDs of all properties in this compound (we'll need them for the period queries)
  const { data: allCompoundProps } = await sb
    .from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived")
    .eq("compound_id", id);
  const propIds = (allCompoundProps ?? []).map((p) => (p as { id: string }).id);

  const [pageRes, rentInPeriod, costsInPeriod] = await Promise.all([
    sb.from("v_property_summary").select("*", { count: "exact" }).eq("compound_id", id).range(from, to),
    propIds.length
      ? sb.from("rent_collections").select("status, net_amount")
          .in("property_id", propIds)
          .gte("due_date", period.from)
          .lte("due_date", period.to)
      : Promise.resolve({ data: [] }),
    propIds.length
      ? sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on, payable_by_lessee)")
          .in("property_id", propIds)
          .eq("costs.payable_by_lessee", false)
          .gte("costs.incurred_on", period.from)
          .lte("costs.incurred_on", period.to)
      : Promise.resolve({ data: [] }),
  ]);

  const arr = pageRes.data ?? [];
  const total = pageRes.count ?? 0;
  const allProps = (allCompoundProps ?? []) as any[];
  const totalValuation = allProps.reduce((s, p) => s + Number(p.valuation || 0), 0);
  const totalSqft = allProps.reduce((s, p) => s + Number(p.area_sqft || 0), 0);

  const rent = (rentInPeriod.data ?? []) as any[];
  const collected = rent.filter((r) => r.status === "collected").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const outstanding = rent.filter((r) => r.status === "due").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const costs = (costsInPeriod.data ?? []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const net = collected - costs;
  const annualROI = totalValuation > 0 ? ((net / totalValuation) * (365 / Math.max(1, days)) * 100).toFixed(2) : "—";

  return (
    <div>
      <PageHeader
        title={compound.name}
        subtitle={compound.address || undefined}
        actions={
          <>
            {has(profile, "edit_property") && <Link href={`/compounds/${id}/edit`} className="btn-secondary">Edit</Link>}
            {has(profile, "delete_property") && (
              <ConfirmButton
                action={deleteCompoundAction}
                confirm={
                  allProps.length > 0
                    ? `Cannot delete "${compound.name}" — it still has ${allProps.length} ${allProps.length === 1 ? "property" : "properties"}. Move or delete them first.`
                    : `Permanently delete the compound "${compound.name}"? This cannot be undone.`
                }
                label="Delete"
                className="btn-danger"
              />
            )}
          </>
        }
      />

      <DateFilter active={period.range as Range} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(total)} />
        <Kpi label="Total sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Total valuation" value={money(totalValuation)} />
        <Kpi label="ROI annualized" value={annualROI === "—" ? "—" : `${annualROI}%`} hint={`Period net ${money(net)}`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected (period)" value={money(collected)} />
        <Kpi label="Outstanding (period)" value={money(outstanding)} />
        <Kpi label="Costs (period)" value={money(costs)} />
        <Kpi label="Net (period)" value={money(net)} hint={net < 0 ? "Loss" : "Profit"} />
      </div>

      <div className="card p-0">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Properties in this compound</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Property</th>
                <th className="text-right">Sqft</th>
                <th className="text-right">Valuation</th>
                <th className="text-right">Rent collected (all-time)</th>
                <th className="text-right">Costs (all-time)</th>
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
        </div>
        <Pagination page={page} total={total} label="properties" searchParams={sp} />
      </div>
    </div>
  );
}
