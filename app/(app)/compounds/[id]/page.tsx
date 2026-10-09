import { supabaseServer } from "@/lib/supabase/server";
import { rowLink } from "@/lib/row-link";
import { PageHeader } from "@/components/PageHeader";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { getAnalyticsFacts, pruneFacts } from "@/lib/analytics/server";
import { money } from "@/lib/format";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { revalidateApp } from "@/lib/revalidate";
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
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const profile = await guardView("view_compounds");
  const sb = await supabaseServer();

  // One round trip: the page's own rows plus the (cached) analytics facts.
  const [{ data: compound }, { data: allCompoundProps }, pageRes, facts] = await Promise.all([
    sb.from("compounds").select("*").eq("id", id).maybeSingle(),
    sb.from("properties").select("id").eq("compound_id", id),
    sb.from("v_property_summary").select("*", { count: "exact" }).eq("compound_id", id).range(from, to),
    getAnalyticsFacts(),
  ]);
  if (!compound) notFound();

  async function deleteCompoundAction() {
    "use server";
    await requirePermission("delete_property");
    const sb = await supabaseServer();
    const { count } = await sb.from("properties").select("id", { count: "exact", head: true }).eq("compound_id", id);
    if ((count ?? 0) > 0) throw new Error("Compound is not empty");
    const { error } = await sb.from("compounds").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidateApp();
    redirect("/compounds");
  }


  const arr = pageRes.data ?? [];
  const total = pageRes.count ?? 0;
  const allProps = (allCompoundProps ?? []) as any[];

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

      <div className="mb-3">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Analytics</h2>
        <p className="text-[12.5px] text-muted-fg">Everything below is limited to this compound. Click a property or client to drill in.</p>
      </div>
      <AnalyticsDashboard
        facts={pruneFacts(facts, { compoundId: id })}
        lock={{ compounds: [id] }}
        embedded
        links={{ rent: has(profile, "view_rent") }}
      />
      <div className="h-6" />

      {/* PROPERTY TABLE */}
      <div className="card p-0">
        <div className="section-head">
          <h2>Properties</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Property</th>
                <th className="text-right hidden md:table-cell">Sqft</th>
                <th className="text-right hidden sm:table-cell">Valuation</th>
                <th className="text-right hidden lg:table-cell">Rent collected (all-time)</th>
                <th className="text-right hidden lg:table-cell">Costs (all-time)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {arr.map((p) => (
                <tr key={(p as any).id} {...rowLink(has(profile, "view_properties") ? `/properties/${(p as any).id}` : undefined)}>
                  <td><Link href={`/properties/${(p as any).id}`} className="font-medium">{(p as any).name}</Link></td>
                  <td className="text-right hidden md:table-cell">{Number((p as any).area_sqft).toLocaleString()}</td>
                  <td className="text-right hidden sm:table-cell">{money((p as any).valuation)}</td>
                  <td className="text-right hidden lg:table-cell">{money((p as any).total_rent_collected)}</td>
                  <td className="text-right hidden lg:table-cell">{money((p as any).total_costs)}</td>
                  <td>{Number((p as any).active_lease_count) > 0 ? <span className="badge-success">Rented</span> : <span className="badge-muted">Vacant</span>}</td>
                </tr>
              ))}
              {!arr.length && <tr><td colSpan={6} className="!py-10 text-center text-muted-fg">No properties in this compound yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} label="properties" searchParams={sp} />
      </div>
    </div>
  );
}
