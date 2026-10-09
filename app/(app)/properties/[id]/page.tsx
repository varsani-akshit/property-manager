import { supabaseServer } from "@/lib/supabase/server";
import { rowLink } from "@/lib/row-link";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, type Range } from "@/lib/period";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { getAnalyticsFacts, pruneFacts } from "@/lib/analytics/server";
import { ConfirmButton, ConfirmPostButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { revalidateApp } from "@/lib/revalidate";
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
  const rentPage = parsePage(sp.rent_page);
  const costPage = parsePage(sp.cost_page);
  const leasePage = parsePage(sp.lease_page);

  const profile = await guardView("view_properties");
  const canEditCost = has(profile, "add_cost");
  const canLease = has(profile, "view_leases");
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
    facts,
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
    getAnalyticsFacts(),
  ]);

  const rentRows = rentsPageRes.data ?? [];
  const rentTotal = rentsPageRes.count ?? 0;
  const allocsRows = (allocsPageRes.data ?? []) as any[];
  const costTotal = allocsPageRes.count ?? 0;
  const leases = leasesPageRes.data ?? [];
  const leaseTotal = leasesPageRes.count ?? 0;

  async function archiveProperty() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    await sb.from("properties").update({ archived: true }).eq("id", id);
    revalidateApp();
    redirect("/properties");
  }

  const compound = Array.isArray(prop.compounds) ? prop.compounds[0] : prop.compounds;

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Properties", href: "/properties" },
          ...(compound ? [{ label: compound.name, href: `/compounds/${compound.id}` }] : []),
          { label: prop.name },
        ]}
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
      <div className="card mb-2 grid gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <div className="kpi-label">Area · Valuation</div>
          <div className="mt-1.5 text-[14px] font-medium text-fg">{Number(prop.area_sqft).toLocaleString()} sqft</div>
          <div className="mt-0.5 text-[12px] text-muted-fg">{money(prop.valuation)}</div>
        </div>
        <div>
          <div className="kpi-label">Service charge</div>
          <div className="mt-1.5 text-[14px] font-medium text-fg">{money(prop.service_charge_monthly)} / mo</div>
          <div className="mt-0.5 text-[12px] text-muted-fg">{prop.service_charge_start_date ? `Since ${fmtDate(prop.service_charge_start_date)}` : "—"}</div>
        </div>
        <div>
          <div className="kpi-label">Status</div>
          {activeLease ? (
            <>
              <div className="mt-1.5 text-[14px] font-medium text-fg">{(activeLease as any).lessee_name}</div>
              <div className="mt-0.5 text-[12px] text-muted-fg">
                <Link href={`/leases/${(activeLease as any).id}`} className="hover:underline">View lease →</Link>
              </div>
            </>
          ) : (
            <>
              <div className="mt-1.5 text-[14px] font-medium text-muted-fg">Vacant</div>
              {has(profile, "create_lease") && (
                <Link href={`/leases/new?property=${prop.id}`} className="text-[12px] font-medium text-primary hover:underline">Put on rent →</Link>
              )}
            </>
          )}
        </div>
        <div>
          <div className="kpi-label">Current rent</div>
          {activeLease ? (
            <>
              <div className="mt-1.5 text-[14px] font-medium text-fg">{money((activeLease as any).gross_rent_monthly)} / mo</div>
              <div className="mt-0.5 text-[12px] text-muted-fg">
                {(activeLease as any).sc_payment_mode === "lessee_direct" ? "Lessee pays SC" : "We pay SC"} · ends {fmtDate((activeLease as any).end_date)}
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-muted-fg">—</div>
          )}
        </div>
        {prop.deed_url && (
          <div className="border-t border-line-subtle pt-3 sm:col-span-2 md:col-span-4">
            <a href={prop.deed_url} target="_blank" className="text-[12px] font-medium text-primary hover:underline">Property deed →</a>
            {(activeLease as any)?.lessee_doc_url && (
              <>
                <span className="text-muted-fg mx-2">·</span>
                <a href={(activeLease as any).lessee_doc_url} target="_blank" className="text-[12px] font-medium text-primary hover:underline">Lessee documents →</a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 mt-8">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Analytics</h2>
        <p className="text-[12.5px] text-muted-fg">This property only, across every lease it has had.</p>
      </div>
      <AnalyticsDashboard
        facts={pruneFacts(facts, { propertyId: prop.id })}
        lock={{ properties: [prop.id] }}
        embedded
        links={{ rent: has(profile, "view_rent") }}
      />

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">History</h2>
        <DateFilter active={period.range as Range} />
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
                <tr key={r.id} {...rowLink(canLease && r.lease_id ? `/leases/${r.lease_id}` : undefined)}>
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
              {!rentRows.length && <tr><td colSpan={5} className="!py-10 text-center text-muted-fg">No rent in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rentPage} total={rentTotal} paramName="rent_page" searchParams={sp} label="rows" />
      </div>

      {/* COST HISTORY with line items expanded */}
      <div className="card mb-6 p-0">
        <div className="section-head">
          <h2>Cost history (line items)</h2>
          <span className="text-xs text-muted-fg">{costTotal.toLocaleString()} cost{costTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="hidden md:table-cell">Category</th><th className="text-right hidden sm:table-cell">Line</th><th className="text-right">Share</th></tr></thead>
            <tbody>
              {allocsRows.flatMap((a, i) => {
                const cost = a.costs;
                const lineItems = (cost?.cost_line_items ?? []) as any[];
                const allocated = Number(a.allocated_amount);
                const totalLines = Number(cost?.amount ?? lineItems.reduce((s: number, l: any) => s + Number(l.amount || 0), 0));
                if (!lineItems.length) {
                  return [(
                    <tr key={`${i}-only`} {...rowLink(canEditCost && cost?.id ? `/costs/${cost.id}/edit` : undefined)}>
                      <td>{fmtDate(cost?.incurred_on)}</td>
                      <td className="font-medium">{cost?.description}</td>
                      <td className="text-muted-fg hidden md:table-cell">—</td>
                      <td className="text-right hidden sm:table-cell">{money(allocated)}</td>
                      <td className="text-right font-medium">{money(allocated)}</td>
                    </tr>
                  )];
                }
                return lineItems.map((li: any, j: number) => {
                  const share = totalLines > 0 ? (Number(li.amount) / totalLines) * allocated : 0;
                  return (
                    <tr key={`${i}-${j}`} className={j > 0 ? "text-muted-fg" : ""} {...rowLink(canEditCost && cost?.id ? `/costs/${cost.id}/edit` : undefined)}>
                      <td>{j === 0 ? fmtDate(cost?.incurred_on) : ""}</td>
                      <td>{j === 0 ? <span className="font-medium">{cost?.description}</span> : <span className="pl-3">↳</span>}</td>
                      <td className="hidden md:table-cell"><span className="badge-muted">{li.category}</span></td>
                      <td className="text-right hidden sm:table-cell">{money(Number(li.amount))}</td>
                      <td className="text-right font-medium">{money(share)}</td>
                    </tr>
                  );
                });
              })}
              {!allocsRows.length && <tr><td colSpan={5} className="!py-10 text-center text-muted-fg">No costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={costPage} total={costTotal} paramName="cost_page" searchParams={sp} label="entries" />
      </div>

      {/* LEASE HISTORY */}
      <div className="card p-0">
        <div className="section-head">
          <h2>Lease history</h2>
          <span className="text-xs text-muted-fg">{leaseTotal.toLocaleString()} lease{leaseTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Lessee</th><th className="hidden md:table-cell">Start</th><th className="hidden sm:table-cell">End</th><th>Status</th><th className="text-right hidden sm:table-cell">Rent</th><th></th></tr></thead>
            <tbody>
              {leases.map((l: any) => (
                <tr key={l.id} {...rowLink(canLease ? `/leases/${l.id}` : undefined)}>
                  <td className="font-medium">{l.lessee_name}</td>
                  <td className="hidden md:table-cell">{fmtDate(l.start_date)}</td>
                  <td className="hidden sm:table-cell">{fmtDate(l.end_date)}</td>
                  <td>
                    {l.active ? <span className="badge-success">Active</span>
                      : l.cancelled_at ? <span className="badge-danger">Cancelled</span>
                      : <span className="badge-muted">Ended</span>}
                  </td>
                  <td className="text-right hidden sm:table-cell">{money(l.gross_rent_monthly)}</td>
                  <td className="text-right text-muted-fg">{canLease && <ChevronRight size={14} className="ml-auto" aria-hidden />}</td>
                </tr>
              ))}
              {!leases.length && <tr><td colSpan={6} className="!py-10 text-center text-muted-fg">No leases yet.</td></tr>}
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
            className="btn-danger"
          />
        </div>
      )}
    </div>
  );
}
