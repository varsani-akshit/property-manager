import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, type Range } from "@/lib/period";
import { StackedBarTrend, DonutChart } from "@/components/Charts";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";

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

export default async function LeaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rent_page?: string; cost_page?: string; range?: string; from?: string; to?: string; msg?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const profile = await guardView("view_leases");
  const sb = await supabaseServer();

  const { data: lease } = await sb
    .from("leases")
    .select("*, properties(id, name, valuation, area_sqft, service_charge_monthly, compounds(id, name))")
    .eq("id", id)
    .maybeSingle();
  if (!lease) notFound();

  async function backfillRents() {
    "use server";
    await requirePermission("create_lease");
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc("backfill_lease_rents", { p_lease_id: id });
    if (error) throw new Error(error.message);
    revalidatePath(`/leases/${id}`);
    revalidatePath("/rent");
    redirect(`/leases/${id}?msg=${encodeURIComponent(`Inserted ${data ?? 0} rent rows`)}`);
  }

  const leaseStart = (lease as { start_date: string }).start_date;
  const leaseEffectiveEnd =
    (lease as { cancelled_at: string | null }).cancelled_at
      ? String((lease as { cancelled_at: string }).cancelled_at).slice(0, 10)
      : (lease as { end_date: string }).end_date;

  const filterPeriod = resolvePeriod(sp);
  const periodFrom = filterPeriod.from > leaseStart ? filterPeriod.from : leaseStart;
  const periodTo = filterPeriod.to < leaseEffectiveEnd ? filterPeriod.to : leaseEffectiveEnd;
  const days = Math.max(1, Math.round((new Date(periodTo).getTime() - new Date(periodFrom).getTime()) / 86400000));

  const property_id = (lease as { property_id: string }).property_id;

  const rentPage = parsePage(sp.rent_page);
  const costPage = parsePage(sp.cost_page);
  const rangeFor = (p: number): [number, number] => [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1];

  const [
    rentsPageRes,
    allocsPageRes,
    rentPeriodRes,
    costsPeriodRes,
    lesseeCostRes,
  ] = await Promise.all([
    sb.from("rent_collections").select("*", { count: "exact" })
      .eq("lease_id", id)
      .gte("due_date", periodFrom)
      .lte("due_date", periodTo)
      .order("due_date", { ascending: false })
      .range(...rangeFor(rentPage)),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(id, description, incurred_on, amount, payable_by_lessee, cost_line_items(category, amount))", { count: "exact" })
      .eq("property_id", property_id)
      .eq("costs.payable_by_lessee", false)
      .gte("costs.incurred_on", periodFrom)
      .lte("costs.incurred_on", periodTo)
      .order("costs(incurred_on)", { ascending: false })
      .range(...rangeFor(costPage)),
    sb.from("rent_collections").select("status, net_amount, collected_amount, collected_at, due_date")
      .eq("lease_id", id)
      .gte("due_date", periodFrom)
      .lte("due_date", periodTo),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on, amount, payable_by_lessee, cost_line_items(category, amount))")
      .eq("property_id", property_id)
      .eq("costs.payable_by_lessee", false)
      .gte("costs.incurred_on", periodFrom)
      .lte("costs.incurred_on", periodTo),
    // Lessee-billed costs (separate flow — what the tenant owes us)
    sb.from("costs").select("id, description, amount, due_date, collected_amount, collection_status, collected_at, cost_line_items(category, amount)")
      .eq("payable_by_lessee", true)
      .eq("lease_id", id)
      .order("due_date", { ascending: false }),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocs = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;

  const rent = (rentPeriodRes.data ?? []) as any[];
  const collected = rent
    .filter((r) => r.status === "collected" || r.status === "partial")
    .reduce((s, r) => s + Number(r.collected_amount || (r.status === "collected" ? r.net_amount : 0)), 0);
  const billed = rent.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const outstanding = rent
    .filter((r) => r.status === "due" || r.status === "partial")
    .reduce((s, r) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)), 0);

  const costsPeriod = (costsPeriodRes.data ?? []) as any[];
  const totalCosts = costsPeriod.reduce((s, a) => s + Number(a.allocated_amount), 0);
  const net = collected - totalCosts;
  const collectionRate = billed > 0 ? (collected / billed) * 100 : null;

  const lesseeCosts = (lesseeCostRes.data ?? []) as any[];
  const lesseeBilled = lesseeCosts.reduce((s, c) => s + Number(c.amount || 0), 0);
  const lesseeCollected = lesseeCosts.reduce((s, c) => s + Number(c.collected_amount || 0), 0);
  const lesseeOutstanding = Math.max(0, lesseeBilled - lesseeCollected);

  // === TREND ===
  const months = listMonths(periodFrom, periodTo);
  const monthBuckets = new Map<string, { collected: number; costs: number }>();
  for (const m of months) monthBuckets.set(m, { collected: 0, costs: 0 });
  for (const r of rent) {
    if (r.status === "collected" && r.collected_at) {
      const k = ymKey(r.collected_at);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.collected += Number(r.net_amount || 0);
    }
  }
  for (const c of costsPeriod) {
    const incurred = c.costs?.incurred_on;
    if (incurred) {
      const k = ymKey(incurred);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.costs += Number(c.allocated_amount || 0);
    }
  }
  const trend = Array.from(monthBuckets.entries()).map(([ym, v]) => ({ ym, ...v }));

  // === COST CATEGORIES ===
  const byCategory: Record<string, number> = {};
  for (const a of costsPeriod) {
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

  const prop = (lease as any).properties;
  const compound = Array.isArray(prop?.compounds) ? prop.compounds[0] : prop?.compounds;
  const isActive = (lease as any).active;
  const wasCancelled = !!(lease as any).cancelled_at;

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Leases", href: "/leases" },
          { label: (lease as { lessee_name: string }).lessee_name },
        ]}
        actions={
          <>
            {has(profile, "create_lease") && (
              <ConfirmButton
                action={backfillRents}
                confirm={`Backfill rent rows for every month from the lease start (${fmtDate((lease as any).start_date)}) through the next 6 months? Existing rows are kept; only missing months get added as 'due'.`}
                label="Backfill rents"
                className="btn-secondary text-xs"
              />
            )}
            {has(profile, "create_lease") && isActive && (
              <Link href={`/leases/${id}/raise-rent`} className="btn-secondary text-xs">Raise rent</Link>
            )}
            {has(profile, "create_lease") && isActive && (
              <Link href={`/leases/${id}/edit`} className="btn-secondary text-xs">Edit</Link>
            )}
            {has(profile, "cancel_lease") && isActive && (
              <ConfirmPostButton
                action={`/api/leases/${id}/cancel`}
                confirm={`Cancel the lease for ${(lease as any).lessee_name}? The lease end date will be set to today and future unpaid rent rows will be removed.`}
                label="Cancel"
                className="btn-danger text-xs"
              />
            )}
          </>
        }
      />

      {sp.msg && (
        <div className="card mb-4 border-success/30 bg-success/5">
          <p className="text-sm text-success">{sp.msg}</p>
        </div>
      )}

      {/* LEASE FACTS */}
      <div className="card mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs uppercase text-muted-fg">Contact</div>
          <div className="font-medium">{(lease as any).lessee_contact || "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Lease period</div>
          <div className="font-medium">{fmtDate(leaseStart)} → {fmtDate((lease as any).end_date)}</div>
          {wasCancelled && <div className="text-xs text-danger">Cancelled {fmtDate((lease as any).cancelled_at)}</div>}
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Status</div>
          <div>
            {isActive ? <span className="badge-success">Active</span>
              : wasCancelled ? <span className="badge-danger">Cancelled</span>
              : <span className="badge-muted">Ended</span>}
          </div>
          <div className="text-xs text-muted-fg mt-1">
            SC: {(lease as any).sc_payment_mode === "lessee_direct" ? "Lessee pays" : "We pay"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-fg">Rent</div>
          <div className="font-medium">{money((lease as any).gross_rent_monthly)} / mo</div>
        </div>
        <div className="col-span-full grid grid-cols-3 gap-3 pt-3 border-t border-border">
          <div>
            <div className="text-xs uppercase text-muted-fg">Deposit charged</div>
            <div className="font-medium">{money((lease as any).deposit_charged ?? (lease as any).deposit_amount ?? 0)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-fg">Deposit collected</div>
            <div className="font-medium">{money((lease as any).deposit_collected ?? 0)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-fg">Deposit shortfall</div>
            {(() => {
              const charged = Number((lease as any).deposit_charged ?? (lease as any).deposit_amount ?? 0);
              const collected = Number((lease as any).deposit_collected ?? 0);
              const shortfall = Math.max(0, charged - collected);
              return (
                <div className={`font-medium ${shortfall > 0 ? "text-danger" : "text-success"}`}>
                  {money(shortfall)}
                </div>
              );
            })()}
          </div>
        </div>
        {(lease as any).lessee_doc_url && (
          <div className="col-span-full pt-2 border-t border-border">
            <a href={(lease as any).lessee_doc_url} target="_blank" className="text-xs text-accent hover:underline">Lessee documents →</a>
          </div>
        )}
      </div>

      <DateFilter active={filterPeriod.range as Range} />

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
          <div className="text-xs text-muted-fg mt-auto">Rent only</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cost charges</div>
          <div className={`kpi-value ${lesseeOutstanding > 0 ? "text-warning" : ""}`}>{money(lesseeOutstanding)}</div>
          <div className="text-xs text-muted-fg mt-auto">
            {lesseeCosts.length} cost{lesseeCosts.length === 1 ? "" : "s"} billed to lessee
          </div>
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
            <span className="text-xs text-muted-fg">{money(totalCosts)} total</span>
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
              {!rentRows.length && <tr><td colSpan={5} className="text-center text-muted-fg py-4">No rent data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="rows" />
      </div>

      {/* COSTS BILLED TO LESSEE */}
      {lesseeCosts.length > 0 && (
        <div className="card mb-6 p-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Cost charges billed to lessee</h2>
            <Link href="/rent" className="text-xs text-accent hover:underline">Collect →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Due date</th><th>Description</th><th>Categories</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Paid</th></tr></thead>
              <tbody>
                {lesseeCosts.map((c) => {
                  const lineItems = (c.cost_line_items ?? []) as { category: string; amount: number }[];
                  return (
                    <tr key={c.id}>
                      <td>{fmtDate(c.due_date)}</td>
                      <td className="font-medium">{c.description}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {lineItems.map((li, i) => (
                            <span key={i} className="badge-muted text-xs">{li.category} · {money(Number(li.amount))}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {c.collection_status === "collected" ? <span className="badge-success">Collected</span>
                          : c.collection_status === "partial" ? <span className="badge-warning">Partial</span>
                          : <span className="badge-warning">Due</span>}
                      </td>
                      <td className="text-right">{money(c.amount)}</td>
                      <td className="text-right">{money(c.collected_amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COSTS WE PAY (allocated to this property) */}
      <div className="card p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Costs we paid (allocated to property)</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} entr{costTotal === 1 ? "y" : "ies"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Line</th><th className="text-right">Property share</th></tr></thead>
            <tbody>
              {allocs.flatMap((a, i) => {
                const cost = a.costs;
                const lineItems = (cost?.cost_line_items ?? []) as any[];
                const allocated = Number(a.allocated_amount);
                const sumLines = Number(cost?.amount ?? lineItems.reduce((s: number, l: any) => s + Number(l.amount || 0), 0));
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
                  const share = sumLines > 0 ? (Number(li.amount) / sumLines) * allocated : 0;
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
              {!allocs.length && <tr><td colSpan={5} className="text-center text-muted-fg py-4">No costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>
    </div>
  );
}
