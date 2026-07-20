import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { StackedBarTrend, DonutChart } from "@/components/Charts";
import { money } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

function ymKey(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function listMonths(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const a = new Date(fromISO + "T00:00:00Z");
  const b = new Date(toISO + "T00:00:00Z");
  let y = a.getUTCFullYear(), m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

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

  const { data: allCompoundProps } = await sb
    .from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived")
    .eq("compound_id", id);
  const propIds = (allCompoundProps ?? []).map((p) => (p as { id: string }).id);

  const [pageRes, rentInPeriod, costsInPeriod, activeLeasesRes] = await Promise.all([
    sb.from("v_property_summary").select("*", { count: "exact" }).eq("compound_id", id).range(from, to),
    propIds.length
      ? sb.from("rent_collections").select("status, net_amount, collected_amount, collected_at, due_date")
          .in("property_id", propIds)
          .gte("due_date", period.from)
          .lte("due_date", period.to)
      : Promise.resolve({ data: [] }),
    propIds.length
      ? sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on, amount, payable_by_lessee, cost_line_items(category, amount))")
          .in("property_id", propIds)
          .eq("costs.payable_by_lessee", false)
          .gte("costs.incurred_on", period.from)
          .lte("costs.incurred_on", period.to)
      : Promise.resolve({ data: [] }),
    propIds.length
      ? sb.from("leases").select("property_id").in("property_id", propIds).eq("active", true)
      : Promise.resolve({ data: [] }),
  ]);

  const arr = pageRes.data ?? [];
  const total = pageRes.count ?? 0;
  const allProps = (allCompoundProps ?? []) as any[];
  const totalValuation = allProps.reduce((s, p) => s + Number(p.valuation || 0), 0);
  const totalSqft = allProps.reduce((s, p) => s + Number(p.area_sqft || 0), 0);

  const rent = ((rentInPeriod.data ?? []) as any[]);
  const collected = rent
    .filter((r) => r.status === "collected" || r.status === "partial")
    .reduce((s, r) => s + Number(r.collected_amount || (r.status === "collected" ? r.net_amount : 0)), 0);
  const billed = rent.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const outstanding = rent
    .filter((r) => r.status === "due" || r.status === "partial")
    .reduce((s, r) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)), 0);
  const collectionRate = billed > 0 ? (collected / billed) * 100 : null;

  const costsInPeriodArr = ((costsInPeriod.data ?? []) as any[]);
  const costs = costsInPeriodArr.reduce((s, a) => s + Number(a.allocated_amount), 0);
  const net = collected - costs;
  const annualROI = totalValuation > 0 ? ((net / totalValuation) * (365 / Math.max(1, days)) * 100) : null;

  const activeLeases = (activeLeasesRes.data ?? []) as any[];
  const occupancyPct = allProps.length > 0 ? (activeLeases.length / allProps.length) * 100 : 0;

  // === TREND ===
  const months = listMonths(period.from, period.to);
  const monthBuckets = new Map<string, { collected: number; costs: number }>();
  for (const m of months) monthBuckets.set(m, { collected: 0, costs: 0 });
  for (const r of rent) {
    if (r.status === "collected" && r.collected_at) {
      const k = ymKey(r.collected_at);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.collected += Number(r.net_amount || 0);
    }
  }
  for (const c of costsInPeriodArr) {
    const incurred = c.costs?.incurred_on;
    if (incurred) {
      const k = ymKey(incurred);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.costs += Number(c.allocated_amount || 0);
    }
  }
  const trend = Array.from(monthBuckets.entries()).map(([ym, v]) => ({ ym, ...v }));

  // === COST CATEGORIES (proportional by line items) ===
  const byCategory: Record<string, number> = {};
  for (const a of costsInPeriodArr) {
    const lineItems = (a.costs?.cost_line_items ?? []) as { category: string; amount: number }[];
    const allocated = Number(a.allocated_amount || 0);
    const totalLines = lineItems.reduce((s, l) => s + Number(l.amount || 0), 0);
    if (totalLines > 0) {
      for (const li of lineItems) {
        byCategory[li.category] = (byCategory[li.category] ?? 0) + (Number(li.amount) / totalLines) * allocated;
      }
    } else {
      byCategory["uncategorized"] = (byCategory["uncategorized"] ?? 0) + allocated;
    }
  }
  const categoryRows = Object.entries(byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Compounds", href: "/compounds" },
          { label: compound.name },
        ]}
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

      {/* FACTS STRIP */}
      <div className="card mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="text-center">
          <div className="text-xs uppercase text-muted-fg">Properties</div>
          <div className="font-semibold text-lg">{allProps.length}</div>
          <div className="text-xs text-muted-fg">{totalSqft.toLocaleString()} sqft</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase text-muted-fg">Total valuation</div>
          <div className="font-semibold text-lg">{money(totalValuation)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase text-muted-fg">Occupancy</div>
          <div className="font-semibold text-lg">{occupancyPct.toFixed(0)}%</div>
          <div className="text-xs text-muted-fg">{activeLeases.length} of {allProps.length} rented</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase text-muted-fg">ROI annualized</div>
          <div className={`font-semibold text-lg ${annualROI !== null && annualROI < 0 ? "text-danger" : ""}`}>
            {annualROI !== null ? `${annualROI.toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>

      <DateFilter active={period.range as Range} />

      {/* HERO KPIs (period) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi">
          <div className="kpi-label">Net</div>
          <div className={`kpi-value ${net < 0 ? "text-danger" : "text-success"}`}>{money(net)}</div>
          <div className="text-xs text-muted-fg mt-auto">{money(collected)} in − {money(costs)} out</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Collection rate</div>
          <div className="kpi-value">{collectionRate !== null ? `${collectionRate.toFixed(0)}%` : "—"}</div>
          <div className="text-xs text-muted-fg mt-auto">{money(collected)} of {money(billed)} billed</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value ${outstanding > 0 ? "text-danger" : ""}`}>{money(outstanding)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Costs</div>
          <div className="kpi-value">{money(costs)}</div>
        </div>
      </div>

      {/* TREND + COST BREAKDOWN — merged */}
      <div className="card p-0 mb-6 grid lg:grid-cols-2 lg:divide-x divide-border">
        <div>
          <div className="section-head"><h2>Monthly trend</h2></div>
          <div className="panel">
            <StackedBarTrend
              data={trend.map((t) => ({ label: t.ym.slice(2), collected: t.collected, costs: t.costs }))}
              formatValue={(n) => money(n)}
            />
          </div>
        </div>
        <div>
          <div className="section-head">
            <h2>Cost breakdown</h2>
            <span className="text-xs text-muted-fg">{money(costs)} total</span>
          </div>
          <div className="panel">
            {categoryRows.length > 0 ? (
              <DonutChart data={categoryRows} formatValue={(n) => money(n)} />
            ) : (
              <p className="text-sm text-muted-fg py-6 text-center">No costs in this period.</p>
            )}
          </div>
        </div>
      </div>

      {/* PROPERTY TABLE */}
      <div className="card p-0">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Properties</h2>
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
