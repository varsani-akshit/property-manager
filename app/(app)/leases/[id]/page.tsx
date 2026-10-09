import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, type Range } from "@/lib/period";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { getAnalyticsFacts, pruneFacts } from "@/lib/analytics/server";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidateApp } from "@/lib/revalidate";

export const dynamic = "force-dynamic";

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
    revalidateApp(`/leases/${id}`);
    revalidateApp("/rent");
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

  const property_id = (lease as { property_id: string }).property_id;

  const rentPage = parsePage(sp.rent_page);
  const costPage = parsePage(sp.cost_page);
  const rangeFor = (p: number): [number, number] => [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1];

  const [
    rentsPageRes,
    allocsPageRes,
    lesseeCostRes,
    facts,
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
    // Lessee-billed costs (separate flow — what the tenant owes us)
    sb.from("costs").select("id, description, amount, due_date, collected_amount, collection_status, collected_at, cost_line_items(category, amount)")
      .eq("payable_by_lessee", true)
      .eq("lease_id", id)
      .order("due_date", { ascending: false }),
    getAnalyticsFacts(),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocs = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;

  const lesseeCosts = (lesseeCostRes.data ?? []) as any[];

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
            {has(profile, "view_rent") && (
              <Link href={`/rent/statement?lease=${id}`} className="btn-secondary">Statement</Link>
            )}
            {has(profile, "create_lease") && (
              <ConfirmButton
                action={backfillRents}
                confirm={`Backfill rent rows for every month from the lease start (${fmtDate((lease as any).start_date)}) through the next 6 months? Existing rows are kept; only missing months get added as 'due'.`}
                label="Backfill rents"
                className="btn-secondary"
              />
            )}
            {has(profile, "create_lease") && isActive && (
              <Link href={`/leases/${id}/raise-rent`} className="btn-secondary">Raise rent</Link>
            )}
            {has(profile, "create_lease") && isActive && (
              <Link href={`/leases/${id}/edit`} className="btn-secondary">Edit</Link>
            )}
            {has(profile, "cancel_lease") && isActive && (
              <ConfirmPostButton
                action={`/api/leases/${id}/cancel`}
                confirm={`Cancel the lease for ${(lease as any).lessee_name}? The lease end date will be set to today and future unpaid rent rows will be removed.`}
                label="Cancel"
                className="btn-danger"
              />
            )}
          </>
        }
      />

      {sp.msg && (
        <div className="mb-4 rounded-xl border border-success/25 bg-success-soft px-3.5 py-3 text-[12.5px] text-success">{sp.msg}</div>
      )}

      {/* LEASE FACTS */}
      <div className="card mb-2 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <div>
          <div className="kpi-label">Contact</div>
          <div className="mt-1.5 text-[14px] font-medium text-fg">{(lease as any).lessee_contact || "—"}</div>
        </div>
        <div>
          <div className="kpi-label">Lease period</div>
          <div className="mt-1.5 text-[14px] font-medium text-fg">{fmtDate(leaseStart)} → {fmtDate((lease as any).end_date)}</div>
          {wasCancelled && <div className="mt-0.5 text-[12px] text-danger">Cancelled {fmtDate((lease as any).cancelled_at)}</div>}
        </div>
        <div>
          <div className="kpi-label">Status</div>
          <div className="mt-1.5">
            {isActive ? <span className="badge-success">Active</span>
              : wasCancelled ? <span className="badge-danger">Cancelled</span>
              : <span className="badge-muted">Ended</span>}
          </div>
          <div className="mt-1 text-[12px] text-muted-fg">
            SC: {(lease as any).sc_payment_mode === "lessee_direct" ? "Lessee pays" : "We pay"}
          </div>
        </div>
        <div>
          <div className="kpi-label">Rent</div>
          <div className="mt-1.5 text-[14px] font-medium text-fg">{money((lease as any).gross_rent_monthly)} / mo</div>
        </div>
        <div className="col-span-full grid grid-cols-1 gap-x-6 gap-y-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
          <div>
            <div className="kpi-label">Deposit charged</div>
            <div className="mt-1.5 text-[14px] font-medium text-fg">{money((lease as any).deposit_charged ?? (lease as any).deposit_amount ?? 0)}</div>
          </div>
          <div>
            <div className="kpi-label">Deposit collected</div>
            <div className="mt-1.5 text-[14px] font-medium text-fg">{money((lease as any).deposit_collected ?? 0)}</div>
          </div>
          <div>
            <div className="kpi-label">Deposit shortfall</div>
            {(() => {
              const charged = Number((lease as any).deposit_charged ?? (lease as any).deposit_amount ?? 0);
              const collected = Number((lease as any).deposit_collected ?? 0);
              const shortfall = Math.max(0, charged - collected);
              return (
                <div className={`mt-1.5 text-[14px] font-medium ${shortfall > 0 ? "text-danger" : "text-success"}`}>
                  {money(shortfall)}
                </div>
              );
            })()}
          </div>
        </div>
        {(lease as any).lessee_doc_url && (
          <div className="col-span-full border-t border-line-subtle pt-3">
            <a href={(lease as any).lessee_doc_url} target="_blank" className="text-[12px] font-medium text-primary hover:underline">Lessee documents →</a>
          </div>
        )}
      </div>

      <div className="mb-3 mt-8">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Analytics</h2>
        <p className="text-[12.5px] text-muted-fg">This lease only.</p>
      </div>
      <AnalyticsDashboard
        facts={pruneFacts(facts, { leaseIds: [id] })}
        lock={{ properties: [(lease as any).property_id], lessees: [(lease as any).lessee_name] }}
        embedded
        links={{ rent: has(profile, "view_rent") }}
      />

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">History</h2>
        <DateFilter active={filterPeriod.range as Range} />
      </div>

      {/* RENT HISTORY */}
      <div className="card mb-6 p-0">
        <div className="section-head">
          <h2>Rent history</h2>
          <span className="text-xs text-muted-fg">{rentTotal.toLocaleString()} row{rentTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Due date</th><th>Status</th><th className="text-right hidden sm:table-cell">Net</th><th className="text-right">Paid</th><th className="hidden md:table-cell">Collected on</th></tr></thead>
            <tbody>
              {rentRows.map((r: any) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.due_date)}</td>
                  <td>
                    {r.status === "collected" ? <span className="badge-success">Collected</span>
                      : r.status === "partial" ? <span className="badge-warning">Partial</span>
                      : <span className="badge-warning">Due</span>}
                  </td>
                  <td className="text-right hidden sm:table-cell">{money(r.net_amount)}</td>
                  <td className="text-right">{money(r.collected_amount)}</td>
                  <td className="hidden md:table-cell">{r.collected_at ? fmtDate(r.collected_at) : "—"}</td>
                </tr>
              ))}
              {!rentRows.length && <tr><td colSpan={5} className="!py-10 text-center text-muted-fg">No rent data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="rows" />
      </div>

      {/* COSTS BILLED TO LESSEE */}
      {lesseeCosts.length > 0 && (
        <div className="card mb-6 p-0">
          <div className="section-head">
            <h2>Cost charges billed to lessee</h2>
            <Link href="/rent" className="text-[12px] font-medium text-primary hover:underline">Collect →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th className="hidden sm:table-cell">Due date</th><th>Description</th><th className="hidden lg:table-cell">Categories</th><th>Status</th><th className="text-right hidden md:table-cell">Total</th><th className="text-right">Paid</th></tr></thead>
              <tbody>
                {lesseeCosts.map((c) => {
                  const lineItems = (c.cost_line_items ?? []) as { category: string; amount: number }[];
                  return (
                    <tr key={c.id}>
                      <td className="hidden sm:table-cell">{fmtDate(c.due_date)}</td>
                      <td className="font-medium">{c.description}</td>
                      <td className="hidden lg:table-cell">
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
                      <td className="text-right hidden md:table-cell">{money(c.amount)}</td>
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
        <div className="section-head">
          <h2>Costs we paid (allocated to property)</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} entr{costTotal === 1 ? "y" : "ies"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="hidden md:table-cell">Category</th><th className="text-right hidden sm:table-cell">Line</th><th className="text-right">Share</th></tr></thead>
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
                      <td className="text-muted-fg hidden md:table-cell">—</td>
                      <td className="text-right hidden sm:table-cell">{money(allocated)}</td>
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
                      <td className="hidden md:table-cell"><span className="badge-muted">{li.category}</span></td>
                      <td className="text-right hidden sm:table-cell">{money(Number(li.amount))}</td>
                      <td className="text-right font-medium">{money(share)}</td>
                    </tr>
                  );
                });
              })}
              {!allocs.length && <tr><td colSpan={5} className="!py-10 text-center text-muted-fg">No costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>
    </div>
  );
}
