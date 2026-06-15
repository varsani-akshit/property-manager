import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

/**
 * Single-lease analytics / archive view.
 * Shows everything that happened during this lease's tenure:
 *   - Rent collections (by lease_id)
 *   - Costs allocated to the property between start_date and end (cancelled_at or today or end_date)
 *
 * A date filter optionally narrows the period further (intersected with the lease range).
 */
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

  async function hardDeleteLease() {
    "use server";
    await requirePermission("cancel_lease");
    const sb = await supabaseServer();
    const { error } = await sb.from("leases").delete().eq("id", id);
    if (error) throw new Error(error.message);
    redirect("/leases");
  }

  const leaseStart = (lease as { start_date: string }).start_date;
  const leaseEffectiveEnd =
    (lease as { cancelled_at: string | null }).cancelled_at
      ? String((lease as { cancelled_at: string }).cancelled_at).slice(0, 10)
      : (lease as { end_date: string }).end_date;

  // Intersect the chosen date filter with the lease lifetime.
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
  ] = await Promise.all([
    sb.from("rent_collections").select("*", { count: "exact" })
      .eq("lease_id", id)
      .gte("due_date", periodFrom)
      .lte("due_date", periodTo)
      .order("due_date", { ascending: false })
      .range(...rangeFor(rentPage)),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(description, incurred_on, cost_line_items(category, amount))", { count: "exact" })
      .eq("property_id", property_id)
      .gte("costs.incurred_on", periodFrom)
      .lte("costs.incurred_on", periodTo)
      .order("costs(incurred_on)", { ascending: false })
      .range(...rangeFor(costPage)),
    sb.from("rent_collections").select("status, net_amount")
      .eq("lease_id", id)
      .gte("due_date", periodFrom)
      .lte("due_date", periodTo),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on)")
      .eq("property_id", property_id)
      .gte("costs.incurred_on", periodFrom)
      .lte("costs.incurred_on", periodTo),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocs = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;

  const rent = (rentPeriodRes.data ?? []) as any[];
  const collected = rent.filter((r) => r.status === "collected").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const outstanding = rent.filter((r) => r.status === "due").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const totalCosts = (costsPeriodRes.data ?? []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const net = collected - totalCosts;
  const periodGross = rent.reduce((s, r) => s + Number(r.net_amount), 0);
  const collectionRate = periodGross > 0 ? (collected / periodGross) * 100 : null;

  const prop = (lease as any).properties;
  const compound = Array.isArray(prop?.compounds) ? prop.compounds[0] : prop?.compounds;

  return (
    <div>
      <PageHeader
        title={(lease as { lessee_name: string }).lessee_name}
        subtitle={`${prop?.name} · ${compound?.name}`}
        actions={
          <>
            <Link href={`/properties/${prop?.id}`} className="btn-secondary text-xs">View property</Link>
            {has(profile, "create_lease") && (
              <ConfirmButton
                action={backfillRents}
                confirm={`Backfill rent rows for every month from the lease start (${fmtDate((lease as any).start_date)}) through this month? Existing rows are kept; only missing months get added as 'due'.`}
                label="Backfill rents"
                className="btn-secondary text-xs"
              />
            )}
            {has(profile, "create_lease") && (lease as { active: boolean }).active && (
              <Link href={`/leases/${id}/edit`} className="btn-secondary text-xs">Edit lease</Link>
            )}
            {has(profile, "cancel_lease") && (lease as { active: boolean }).active && (
              <ConfirmPostButton
                action={`/api/leases/${id}/cancel`}
                confirm={`Cancel the lease for ${(lease as any).lessee_name}? Future unpaid rent rows will be removed. Past data stays as archive.`}
                label="Cancel rental"
                className="btn-secondary text-xs"
              />
            )}
            {has(profile, "cancel_lease") && (
              <ConfirmButton
                action={hardDeleteLease}
                confirm={`PERMANENTLY DELETE the lease for "${(lease as any).lessee_name}"?\n\nThis also deletes every rent row tied to this lease (collected and outstanding).\n\nIf you just want to end the lease but keep the history, use "Cancel rental" instead. This cannot be undone.`}
                label="Delete lease"
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

      <div className="card mb-4">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-fg uppercase">Contact</div>
            <div className="font-medium">{(lease as any).lessee_contact || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg uppercase">Lease period</div>
            <div className="font-medium">{fmtDate(leaseStart)} → {fmtDate((lease as any).end_date)}</div>
            {(lease as any).cancelled_at && (
              <div className="text-xs text-danger">Cancelled {fmtDate((lease as any).cancelled_at)}</div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-fg uppercase">Status</div>
            <div>
              {(lease as any).active
                ? <span className="badge-success">Active</span>
                : (lease as any).cancelled_at
                  ? <span className="badge-danger">Cancelled early</span>
                  : <span className="badge-muted">Ended</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-fg uppercase">Monthly rent</div>
            <div className="font-medium">{money((lease as any).gross_rent_monthly)} gross</div>
            <div className="text-xs text-muted-fg">
              SC mode: {(lease as any).sc_payment_mode === "lessee_direct" ? "Lessee pays directly" : "We pay"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-fg uppercase">Deposit held</div>
            <div className="font-medium">{money((lease as any).deposit_amount ?? 0)}</div>
            <div className="text-xs text-muted-fg">Refundable at end of lease</div>
          </div>
        </div>
        {(lease as any).lessee_doc_url && (
          <div className="mt-3 pt-3 border-t border-border">
            <a href={(lease as any).lessee_doc_url} target="_blank" className="text-sm text-accent hover:underline">Lessee documents →</a>
          </div>
        )}
      </div>

      <DateFilter active={filterPeriod.range as Range} />

      <p className="text-xs text-muted-fg mb-4">
        Showing data for {fmtDate(periodFrom)} → {fmtDate(periodTo)} ({days} days). Intersected with lease lifetime.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected" value={money(collected)} />
        <Kpi label="Outstanding" value={money(outstanding)} />
        <Kpi label="Costs (this property)" value={money(totalCosts)} />
        <Kpi label="Net" value={money(net)} hint={net < 0 ? "Loss" : "Profit"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="Collection rate" value={collectionRate !== null ? `${collectionRate.toFixed(1)}%` : "—"} hint="Collected ÷ (Collected + Due)" />
        <Kpi label="Rent rows" value={String(rent.length)} />
        <Kpi label="Cost rows" value={String((costsPeriodRes.data ?? []).length)} />
      </div>

      <div className="card mb-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Rent history</h2>
          <span className="text-xs text-muted-fg">{rentTotal.toLocaleString()} row{rentTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Due date</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">SC deduction</th><th className="text-right">Net</th><th>Collected on</th></tr></thead>
            <tbody>
              {rentRows.map((r: any) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.due_date)}</td>
                  <td>{r.status === "collected" ? <span className="badge-success">Collected</span> : <span className="badge-warning">Due</span>}</td>
                  <td className="text-right">{money(r.gross_amount)}</td>
                  <td className="text-right text-muted-fg">{money(r.service_charge_deduction)}</td>
                  <td className="text-right font-medium">{money(r.net_amount)}</td>
                  <td>{r.collected_at ? fmtDate(r.collected_at) : "—"}</td>
                </tr>
              ))}
              {!rentRows.length && <tr><td colSpan={6} className="text-center text-muted-fg py-4">No rent data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="rows" />
      </div>

      <div className="card p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Costs allocated to this property (during this period)</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} entr{costTotal === 1 ? "y" : "ies"}</span>
        </div>
        <p className="text-xs text-muted-fg px-3 pt-2">
          Costs allocated to {prop?.name} between {fmtDate(periodFrom)} and {fmtDate(periodTo)}. Includes both lease-specific and compound-wide costs.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Categories</th><th className="text-right">Allocated</th></tr></thead>
            <tbody>
              {allocs.map((a, i) => {
                const li = (a.costs?.cost_line_items ?? []) as any[];
                return (
                  <tr key={i}>
                    <td>{fmtDate(a.costs?.incurred_on)}</td>
                    <td>{a.costs?.description}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {li.map((l: any, j: number) => <span key={j} className="badge-muted">{l.category}</span>)}
                      </div>
                    </td>
                    <td className="text-right">{money(a.allocated_amount)}</td>
                  </tr>
                );
              })}
              {!allocs.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No costs hit this property in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>
    </div>
  );
}
