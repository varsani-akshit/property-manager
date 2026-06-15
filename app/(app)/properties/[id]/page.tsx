import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter, resolvePeriod, periodDays, type Range } from "@/components/DateFilter";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";

export const dynamic = "force-dynamic";

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
  ] = await Promise.all([
    sb.from("leases").select("*").eq("property_id", id).eq("active", true).maybeSingle(),
    // Rent history (period-filtered by due_date)
    sb.from("rent_collections").select("*", { count: "exact" })
      .eq("property_id", id)
      .gte("due_date", period.from)
      .lte("due_date", period.to)
      .order("due_date", { ascending: false })
      .range(...rangeFor(rentPage)),
    // Cost allocations in period
    sb.from("cost_allocations").select("allocated_amount, costs!inner(description, incurred_on, cost_line_items(category, amount))", { count: "exact" })
      .eq("property_id", id)
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to)
      .order("costs(incurred_on)", { ascending: false })
      .range(...rangeFor(costPage)),
    // All leases (not period-filtered — leases overlapping the period would be complex)
    sb.from("leases").select("*", { count: "exact" })
      .eq("property_id", id)
      .order("start_date", { ascending: false })
      .range(...rangeFor(leasePage)),
    // Period totals for rent
    sb.from("rent_collections").select("status, net_amount, collected_at")
      .eq("property_id", id)
      .gte("due_date", period.from)
      .lte("due_date", period.to),
    // Period totals for costs
    sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on)")
      .eq("property_id", id)
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocsRows = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;
  const leases = leasesPageRes.data ?? [];
  const leaseTotal = leasesPageRes.count ?? 0;

  const periodRent = (rentInPeriodRes.data ?? []) as any[];
  const collected = periodRent.filter((r) => r.status === "collected").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const dueOutstanding = periodRent.filter((r) => r.status === "due").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const totalCosts = (costsInPeriodRes.data ?? []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const net = collected - totalCosts;
  const annualROI = prop.valuation > 0 ? ((net / Number(prop.valuation)) * (365 / Math.max(1, days)) * 100).toFixed(2) : "—";
  const periodROI = prop.valuation > 0 ? ((net / Number(prop.valuation)) * 100).toFixed(2) : "—";

  async function archiveProperty() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    await sb.from("properties").update({ archived: true }).eq("id", id);
    redirect("/properties");
  }

  async function hardDeleteProperty() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    const { error } = await sb.from("properties").delete().eq("id", id);
    if (error) throw new Error(error.message);
    redirect("/properties");
  }

  return (
    <div>
      <PageHeader
        title={prop.name}
        subtitle={prop.compounds?.name}
        actions={
          <>
            {has(profile, "edit_property") && (
              <Link href={`/properties/${prop.id}/edit`} className="btn-secondary">Edit</Link>
            )}
            {has(profile, "create_lease") && !activeLease && (
              <Link href={`/leases/new?property=${prop.id}`} className="btn-primary">Put on rent</Link>
            )}
            {has(profile, "delete_property") && (
              <>
                <ConfirmButton
                  action={archiveProperty}
                  confirm={`Archive "${prop.name}"? It will be hidden from lists but kept in the database with all its history.`}
                  label="Archive"
                  className="btn-secondary"
                />
                <ConfirmButton
                  action={hardDeleteProperty}
                  confirm={`PERMANENTLY DELETE "${prop.name}"?\n\nThis will also delete:\n- All leases on this property and their rent rows\n- All service charge rows for this property\n- All cost allocations to this property\n\nCosts themselves are kept. This cannot be undone.`}
                  label="Delete"
                  className="btn-danger"
                />
              </>
            )}
          </>
        }
      />

      <DateFilter active={period.range as Range} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Area" value={`${Number(prop.area_sqft).toLocaleString()} sqft`} />
        <Kpi label="Valuation" value={money(prop.valuation)} />
        <Kpi label="Service charge/mo" value={money(prop.service_charge_monthly)} hint={prop.service_charge_start_date ? `Since ${fmtDate(prop.service_charge_start_date)}` : undefined} />
        <Kpi label="ROI annualized" value={annualROI === "—" ? "—" : `${annualROI}%`} hint={`Period ROI ${periodROI}%`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected (period)" value={money(collected)} />
        <Kpi label="Outstanding rent (period)" value={money(dueOutstanding)} />
        <Kpi label="Costs (period)" value={money(totalCosts)} />
        <Kpi label="Net (period)" value={money(net)} hint={net < 0 ? "Loss" : "Profit"} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold mb-3">Current lease</h2>
          {activeLease ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-muted-fg">Lessee</dt><dd>{activeLease.lessee_name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-fg">Contact</dt><dd>{activeLease.lessee_contact || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-fg">Start</dt><dd>{fmtDate(activeLease.start_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-fg">End</dt><dd>{fmtDate(activeLease.end_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-fg">Gross rent</dt><dd>{money(activeLease.gross_rent_monthly)}</dd></div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">SC mode</dt>
                <dd>{activeLease.sc_payment_mode === "lessee_direct" ? "Lessee pays directly" : "We pay"}</dd>
              </div>
              {activeLease.lessee_doc_url && (
                <div><a href={activeLease.lessee_doc_url} target="_blank" className="text-accent hover:underline">Lessee documents →</a></div>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                <Link href={`/leases/${activeLease.id}`} className="btn-secondary text-xs">View lease analytics</Link>
                {has(profile, "create_lease") && (
                  <Link href={`/leases/${activeLease.id}/edit`} className="btn-secondary text-xs">Edit lease</Link>
                )}
                {has(profile, "cancel_lease") && (
                  <ConfirmPostButton
                    action={`/api/leases/${activeLease.id}/cancel`}
                    confirm={`Cancel the active lease for ${activeLease.lessee_name}? Future unpaid rent rows will be removed.`}
                    label="Cancel rental"
                  />
                )}
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-fg">Vacant. {has(profile, "create_lease") && <Link href={`/leases/new?property=${prop.id}`} className="text-accent hover:underline">Put on rent</Link>}</p>
          )}
          {prop.deed_url && (
            <div className="mt-3 pt-3 border-t border-border">
              <a href={prop.deed_url} target="_blank" className="text-sm text-accent hover:underline">Property deed →</a>
            </div>
          )}
        </div>

        <div className="card p-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Rent history ({period.label})</h2>
            <span className="text-xs text-muted-fg">{rentTotal.toLocaleString()} row{rentTotal === 1 ? "" : "s"}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Due date</th><th>Status</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {rentRows.map((r: any) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.due_date)}</td>
                    <td>{r.status === "collected" ? <span className="badge-success">Collected</span> : <span className="badge-warning">Due</span>}</td>
                    <td className="text-right">{money(r.net_amount)}</td>
                  </tr>
                ))}
                {!rentRows.length && <tr><td colSpan={3} className="text-muted-fg text-center py-4">No rent in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="months" />
        </div>
      </div>

      <div className="card mt-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Cost history ({period.label})</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} row{costTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Categories</th><th className="text-right">Allocated</th></tr></thead>
            <tbody>
              {allocsRows.map((a, i) => {
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
              {!allocsRows.length && <tr><td colSpan={4} className="text-muted-fg text-center py-4">No costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>

      <div className="card mt-6 p-0">
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
                  <td>{l.lessee_name}</td>
                  <td>{fmtDate(l.start_date)}</td>
                  <td>{fmtDate(l.end_date)}</td>
                  <td>{l.active ? <span className="badge-success">Active</span> : <span className="badge-muted">Ended</span>}</td>
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
    </div>
  );
}
