import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { StackedBarTrend, DonutChart } from "@/components/Charts";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";

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

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rent_page?: string; cost_page?: string; lease_page?: string; range?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const days = periodDays(period);
  const rentPage = parsePage(sp.rent_page);
  const costPage = parsePage(sp.cost_page);
  const leasePage = parsePage(sp.lease_page);

  const profile = await guardView("view_properties");
  const sb = await supabaseServer();

  const { data: prop } = await sb
    .from("properties")
    .select("*, compounds(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!prop) notFound();

  const rangeFor = (p: number): [number, number] => [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1];

  const [
    { data: activeLease },
    rentsPageRes,
    allocsPageRes,
    leasesPageRes,
    rentInPeriodRes,
    costsInPeriodRes,
    lineItemsRes,
  ] = await Promise.all([
    sb.from("leases").select("*").eq("property_id", id).eq("active", true).maybeSingle(),
    sb.from("rent_collections").select("*", { count: "exact" })
      .eq("property_id", id)
      .gte("due_date", period.from)
      .lte("due_date", period.to)
      .order("due_date", { ascending: false })
      .range(...rangeFor(rentPage)),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(id, description, incurred_on, amount, payable_by_lessee, cost_line_items(category, amount))", { count: "exact" })
      .eq("property_id", id)
      .eq("costs.payable_by_lessee", false)
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to)
      .order("costs(incurred_on)", { ascending: false })
      .range(...rangeFor(costPage)),
    sb.from("leases").select("*", { count: "exact" })
      .eq("property_id", id)
      .order("start_date", { ascending: false })
      .range(...rangeFor(leasePage)),
    sb.from("rent_collections").select("status, net_amount, collected_amount, collected_at, due_date")
      .eq("property_id", id)
      .gte("due_date", period.from)
      .lte("due_date", period.to),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on, amount, payable_by_lessee, cost_line_items(category, amount))")
      .eq("property_id", id)
      .eq("costs.payable_by_lessee", false)
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to),
    // For category breakdown — derive from same query as above
    Promise.resolve(null),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocsRows = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;
  const leases = leasesPageRes.data ?? [];
  const leaseTotal = leasesPageRes.count ?? 0;

  const periodRent = (rentInPeriodRes.data ?? []) as any[];
  const collected = periodRent
    .filter((r) => r.status === "collected" || r.status === "partial")
    .reduce((s, r) => s + Number(r.collected_amount || (r.status === "collected" ? r.net_amount : 0)), 0);
  const billed = periodRent.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const outstanding = periodRent
    .filter((r) => r.status === "due" || r.status === "partial")
    .reduce((s, r) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)), 0);
  const collectionRate = billed > 0 ? (collected / billed) * 100 : null;

  const costsInPeriod = (costsInPeriodRes.data ?? []) as any[];
  const totalCosts = costsInPeriod.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const net = collected - totalCosts;
  const annualROI = prop.valuation > 0 ? ((net / Number(prop.valuation)) * (365 / Math.max(1, days)) * 100) : null;

  // === MONTHLY TREND ===
  const months = listMonths(period.from, period.to);
  const monthBuckets = new Map<string, { collected: number; costs: number }>();
  for (const m of months) monthBuckets.set(m, { collected: 0, costs: 0 });
  for (const r of periodRent) {
    if (r.status === "collected" && r.collected_at) {
      const k = ymKey(r.collected_at);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.collected += Number(r.net_amount || 0);
    }
  }
  for (const c of costsInPeriod) {
    const incurred = c.costs?.incurred_on;
    if (incurred) {
      const k = ymKey(incurred);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.costs += Number(c.allocated_amount || 0);
    }
  }
  const trend = Array.from(monthBuckets.entries()).map(([ym, v]) => ({ ym, ...v }));

  // === COST CATEGORIES (proportional share of line items) ===
  const byCategory: Record<string, number> = {};
  for (const a of costsInPeriod) {
    const lineItems = (a.costs?.cost_line_items ?? []) as { category: string; amount: number }[];
    const allocated = Number(a.allocated_amount || 0);
    const totalLines = lineItems.reduce((s, l) => s + Number(l.amount || 0), 0);
    if (totalLines > 0) {
      for (const li of lineItems) {
        const share = (Number(li.amount) / totalLines) * allocated;
        byCategory[li.category] = (byCategory[li.category] ?? 0) + share;
      }
    } else {
      byCategory["uncategorized"] = (byCategory["uncategorized"] ?? 0) + allocated;
    }
  }
  const categoryRows = Object.entries(byCategory)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  async function archiveProperty() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    await sb.from("properties").update({ archived: true }).eq("id", id);
    redirect("/properties");
  }

  const compound = Array.isArray(prop.compounds) ? prop.compounds[0] : prop.compounds;

  return (
    <div>
      <PageHeader
        title={prop.name}
        subtitle={compound?.name}
        actions={
          <>
            {has(profile, "edit_property") && (
              <Link href={`/properties/${prop.id}/edit`} className="btn-secondary">Edit</Link>
            )}
            {has(profile, "create_lease") && !activeLease && (
              <Link href={`/leases/new?property=${prop.id}`} className="btn-primary">Put on rent</Link>
            )}
            {has(profile, "delete_property") && (
              <ConfirmButton
                action={archiveProperty}
                confirm={`Archive "${prop.name}"? It will be hidden from lists but kept in the database with all its history.`}
                label="Archive"
                className="btn-danger"
              />
            )}
          </>
        }
      />

      {/* PROPERTY + LEASE FACTS */}
      <div className="card mb-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs uppercase text-muted-fg">Area · Valuation</div>
          <div className="font-medium">{Number(prop.area_sqft).toLocaleString()} sqft</div>
          <div className="text-xs text-muted-fg">{money(prop.valuation)}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Service charge</div>
          <div className="font-medium">{money(prop.service_charge_monthly)} / mo</div>
          <div className="text-xs text-muted-fg">{prop.service_charge_start_date ? `Since ${fmtDate(prop.service_charge_start_date)}` : "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Status</div>
          {activeLease ? (
            <>
              <div className="font-medium">{(activeLease as any).lessee_name}</div>
              <div className="text-xs text-muted-fg">
                <Link href={`/leases/${(activeLease as any).id}`} className="hover:underline">View lease →</Link>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium text-muted-fg">Vacant</div>
              {has(profile, "create_lease") && (
                <Link href={`/leases/new?property=${prop.id}`} className="text-xs text-accent hover:underline">Put on rent →</Link>
              )}
            </>
          )}
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Current rent</div>
          {activeLease ? (
            <>
              <div className="font-medium">{money((activeLease as any).gross_rent_monthly)} / mo</div>
              <div className="text-xs text-muted-fg">
                {(activeLease as any).sc_payment_mode === "lessee_direct" ? "Lessee pays SC" : "We pay SC"} · ends {fmtDate((activeLease as any).end_date)}
              </div>
            </>
          ) : (
            <div className="text-muted-fg">—</div>
          )}
        </div>
        {prop.deed_url && (
          <div className="sm:col-span-2 md:col-span-4 pt-3 border-t border-border">
            <a href={prop.deed_url} target="_blank" className="text-xs text-accent hover:underline">Property deed →</a>
            {(activeLease as any)?.lessee_doc_url && (
              <>
                <span className="text-muted-fg mx-2">·</span>
                <a href={(activeLease as any).lessee_doc_url} target="_blank" className="text-xs text-accent hover:underline">Lessee documents →</a>
              </>
            )}
          </div>
        )}
      </div>

      <DateFilter active={period.range as Range} />

      {/* HERO KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi">
          <div className="kpi-label">Net</div>
          <div className={`kpi-value ${net < 0 ? "text-danger" : "text-success"}`}>{money(net)}</div>
          <div className="text-xs text-muted-fg mt-auto">{money(collected)} in − {money(totalCosts)} out</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Collection rate</div>
          <div className="kpi-value">{collectionRate !== null ? `${collectionRate.toFixed(0)}%` : "—"}</div>
          <div className="text-xs text-muted-fg mt-auto">{money(collected)} of {money(billed)} billed</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value ${outstanding > 0 ? "text-danger" : ""}`}>{money(outstanding)}</div>
          <div className="text-xs text-muted-fg mt-auto">In selected period</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ROI annualized</div>
          <div className={`kpi-value ${annualROI !== null && annualROI < 0 ? "text-danger" : ""}`}>
            {annualROI !== null ? `${annualROI.toFixed(2)}%` : "—"}
          </div>
          <div className="text-xs text-muted-fg mt-auto">On {money(prop.valuation)}</div>
        </div>
      </div>

      {/* TREND + COST BREAKDOWN side by side */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h2 className="font-semibold mb-3">Monthly trend</h2>
          <StackedBarTrend
            data={trend.map((t) => ({ label: t.ym.slice(2), collected: t.collected, costs: t.costs }))}
            formatValue={(n) => money(n)}
          />
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Cost breakdown</h2>
            <span className="text-xs text-muted-fg">{money(totalCosts)} total</span>
          </div>
          {categoryRows.length > 0 ? (
            <DonutChart data={categoryRows} formatValue={(n) => money(n)} />
          ) : (
            <p className="text-sm text-muted-fg py-6 text-center">No costs in this period.</p>
          )}
        </div>
      </div>

      {/* RENT HISTORY */}
      <div className="card mb-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Rent history</h2>
          <span className="text-xs text-muted-fg">{rentTotal.toLocaleString()} row{rentTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Due date</th><th>Status</th><th className="text-right">Net</th><th className="text-right">Paid</th><th>Collected on</th></tr></thead>
            <tbody>
              {rentRows.map((r: any) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.due_date)}</td>
                  <td>
                    {r.status === "collected" ? <span className="badge-success">Collected</span>
                      : r.status === "partial" ? <span className="badge-warning">Partial</span>
                      : <span className="badge-warning">Due</span>}
                  </td>
                  <td className="text-right">{money(r.net_amount)}</td>
                  <td className="text-right">{money(r.collected_amount)}</td>
                  <td>{r.collected_at ? fmtDate(r.collected_at) : "—"}</td>
                </tr>
              ))}
              {!rentRows.length && <tr><td colSpan={5} className="text-muted-fg text-center py-4">No rent in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="rows" />
      </div>

      {/* COST HISTORY with line items expanded */}
      <div className="card mb-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Cost history (line items)</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} cost{costTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Line</th><th className="text-right">Property share</th></tr></thead>
            <tbody>
              {allocsRows.flatMap((a, i) => {
                const cost = a.costs;
                const lineItems = (cost?.cost_line_items ?? []) as any[];
                const allocated = Number(a.allocated_amount);
                const totalLines = Number(cost?.amount ?? lineItems.reduce((s: number, l: any) => s + Number(l.amount || 0), 0));
                if (!lineItems.length) {
                  return [(
                    <tr key={`${i}-only`}>
                      <td>{fmtDate(cost?.incurred_on)}</td>
                      <td className="font-medium">{cost?.description}</td>
                      <td className="text-muted-fg">—</td>
                      <td className="text-right">{money(allocated)}</td>
                      <td className="text-right font-medium">{money(allocated)}</td>
                    </tr>
                  )];
                }
                return lineItems.map((li: any, j: number) => {
                  const share = totalLines > 0 ? (Number(li.amount) / totalLines) * allocated : 0;
                  return (
                    <tr key={`${i}-${j}`} className={j > 0 ? "text-muted-fg" : ""}>
                      <td>{j === 0 ? fmtDate(cost?.incurred_on) : ""}</td>
                      <td>{j === 0 ? <span className="font-medium">{cost?.description}</span> : <span className="pl-3">↳</span>}</td>
                      <td><span className="badge-muted">{li.category}</span></td>
                      <td className="text-right">{money(Number(li.amount))}</td>
                      <td className="text-right font-medium">{money(share)}</td>
                    </tr>
                  );
                });
              })}
              {!allocsRows.length && <tr><td colSpan={5} className="text-muted-fg text-center py-4">No costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>

      {/* LEASE HISTORY */}
      <div className="card p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Lease history</h2>
          <span className="text-xs text-muted-fg">{leaseTotal.toLocaleString()} lease{leaseTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Lessee</th><th>Start</th><th>End</th><th>Status</th><th className="text-right">Rent</th><th></th></tr></thead>
            <tbody>
              {leases.map((l: any) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.lessee_name}</td>
                  <td>{fmtDate(l.start_date)}</td>
                  <td>{fmtDate(l.end_date)}</td>
                  <td>
                    {l.active ? <span className="badge-success">Active</span>
                      : l.cancelled_at ? <span className="badge-danger">Cancelled</span>
                      : <span className="badge-muted">Ended</span>}
                  </td>
                  <td className="text-right">{money(l.gross_rent_monthly)}</td>
                  <td className="text-right"><Link href={`/leases/${l.id}`} className="btn-secondary text-xs">View</Link></td>
                </tr>
              ))}
              {!leases.length && <tr><td colSpan={6} className="text-muted-fg text-center py-4">No leases yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={leasePage} total={leaseTotal} paramName="lease_page" searchParams={sp} label="leases" />
      </div>

      {has(profile, "cancel_lease") && activeLease && (
        <div className="mt-4 flex justify-end">
          <ConfirmPostButton
            action={`/api/leases/${(activeLease as any).id}/cancel`}
            confirm={`Cancel the active lease for ${(activeLease as any).lessee_name}? Future unpaid rent rows will be removed.`}
            label="Cancel active rental"
            className="btn-danger text-xs"
          />
        </div>
      )}
    </div>
  );
}
