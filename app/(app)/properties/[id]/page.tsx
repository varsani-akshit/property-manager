import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
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
  searchParams: Promise<{ rent_page?: string; cost_page?: string; lease_page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
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
    rentTotalsRes,
    costTotalsRes,
  ] = await Promise.all([
    sb.from("leases").select("*").eq("property_id", id).eq("active", true).maybeSingle(),
    sb.from("rent_collections").select("*", { count: "exact" }).eq("property_id", id).order("due_month", { ascending: false }).range(...rangeFor(rentPage)),
    sb.from("cost_allocations").select("allocated_amount, costs(description, category, incurred_on)", { count: "exact" }).eq("property_id", id).order("created_at", { ascending: false }).range(...rangeFor(costPage)),
    sb.from("leases").select("*", { count: "exact" }).eq("property_id", id).order("start_date", { ascending: false }).range(...rangeFor(leasePage)),
    // Totals across ALL rent + cost rows (not paginated).
    sb.from("rent_collections").select("status, net_amount").eq("property_id", id),
    sb.from("cost_allocations").select("allocated_amount").eq("property_id", id),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocsRows = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;
  const leases = leasesPageRes.data ?? [];
  const leaseTotal = leasesPageRes.count ?? 0;

  const collected = (rentTotalsRes.data ?? []).filter((r) => (r as any).status === "collected").reduce((s: number, r) => s + Number((r as any).net_amount), 0);
  const dueOutstanding = (rentTotalsRes.data ?? []).filter((r) => (r as any).status === "due").reduce((s: number, r) => s + Number((r as any).net_amount), 0);
  const totalCosts = (costTotalsRes.data ?? []).reduce((s: number, a) => s + Number((a as any).allocated_amount), 0);
  const net = collected - totalCosts;
  const returnPct = prop.valuation > 0 ? ((net / Number(prop.valuation)) * 100).toFixed(2) : "—";

  async function deleteProperty() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    await sb.from("properties").update({ archived: true }).eq("id", id);
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
              <form action={deleteProperty}>
                <button className="btn-danger">Archive</button>
              </form>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Area" value={`${Number(prop.area_sqft).toLocaleString()} sqft`} />
        <Kpi label="Valuation" value={money(prop.valuation)} />
        <Kpi label="Service charge/mo" value={money(prop.service_charge_monthly)} hint={prop.service_charge_start_date ? `Since ${fmtDate(prop.service_charge_start_date)}` : undefined} />
        <Kpi label="Return on valuation" value={returnPct === "—" ? "—" : `${returnPct}%`} hint={`Net ${money(net)}`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected" value={money(collected)} />
        <Kpi label="Outstanding rent" value={money(dueOutstanding)} />
        <Kpi label="Total costs" value={money(totalCosts)} />
        <Kpi label="Net profit" value={money(net)} />
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
              <div className="flex justify-between"><dt className="text-muted-fg">Lessee pays service charge</dt><dd>{activeLease.lessee_pays_service_charge ? "Yes" : "No"}</dd></div>
              {activeLease.lessee_pays_service_charge && (
                <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                  <dt>Net rent we receive</dt>
                  <dd>{money(Number(activeLease.gross_rent_monthly) - Number(prop.service_charge_monthly))}</dd>
                </div>
              )}
              {activeLease.lessee_doc_url && (
                <div><a href={activeLease.lessee_doc_url} target="_blank" className="text-accent hover:underline">Lessee documents →</a></div>
              )}
              <div className="flex gap-2 mt-3">
                {has(profile, "create_lease") && (
                  <Link href={`/leases/${activeLease.id}/edit`} className="btn-secondary text-xs">Edit lease</Link>
                )}
                {has(profile, "cancel_lease") && (
                  <form action={`/api/leases/${activeLease.id}/cancel`} method="post">
                    <button className="btn-danger text-xs">Cancel rental</button>
                  </form>
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
            <h2 className="font-semibold">Rent history</h2>
            <span className="text-xs text-muted-fg">{rentTotal.toLocaleString()} row{rentTotal === 1 ? "" : "s"}</span>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Month</th><th>Status</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {rentRows.map((r: any) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.due_month)}</td>
                  <td>{r.status === "collected" ? <span className="badge-success">Collected</span> : <span className="badge-warning">Due</span>}</td>
                  <td className="text-right">{money(r.net_amount)}</td>
                </tr>
              ))}
              {!rentRows.length && <tr><td colSpan={3} className="text-muted-fg text-center py-4">No rent history yet.</td></tr>}
            </tbody>
          </table></div>
          <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="months" />
        </div>
      </div>

      <div className="card mt-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Cost history</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} row{costTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Allocated</th></tr></thead>
          <tbody>
            {allocsRows.map((a, i) => (
              <tr key={i}>
                <td>{fmtDate(a.costs?.incurred_on)}</td>
                <td>{a.costs?.description}</td>
                <td><span className="badge-muted">{a.costs?.category}</span></td>
                <td className="text-right">{money(a.allocated_amount)}</td>
              </tr>
            ))}
            {!allocsRows.length && <tr><td colSpan={4} className="text-muted-fg text-center py-4">No costs allocated yet.</td></tr>}
          </tbody>
        </table></div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>

      <div className="card mt-6 p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Lease history</h2>
          <span className="text-xs text-muted-fg">{leaseTotal.toLocaleString()} lease{leaseTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Lessee</th><th>Start</th><th>End</th><th>Status</th><th className="text-right">Rent</th></tr></thead>
          <tbody>
            {leases.map((l: any) => (
              <tr key={l.id}>
                <td>{l.lessee_name}</td>
                <td>{fmtDate(l.start_date)}</td>
                <td>{fmtDate(l.end_date)}</td>
                <td>{l.active ? <span className="badge-success">Active</span> : <span className="badge-muted">Ended</span>}</td>
                <td className="text-right">{money(l.gross_rent_monthly)}</td>
              </tr>
            ))}
            {!leases.length && <tr><td colSpan={5} className="text-muted-fg text-center py-4">No leases yet.</td></tr>}
          </tbody>
        </table></div>
        <Pagination page={leasePage} total={leaseTotal} paramName="lease_page" searchParams={sp} label="leases" />
      </div>
    </div>
  );
}
