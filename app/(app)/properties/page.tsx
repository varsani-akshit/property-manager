import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  name: string;
  area_sqft: number;
  valuation: number;
  service_charge_monthly: number;
  archived: boolean;
  compounds: { name: string } | { name: string }[] | null;
  leases: { id: string; active: boolean; lessee_name: string; gross_rent_monthly: number }[] | null;
};

function compoundName(c: PropertyRow["compounds"]): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await guardView("view_properties");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();

  // Page of rows (with count) + a separate summary that aggregates ALL active properties.
  const [pageRes, summaryRes] = await Promise.all([
    sb.from("properties")
      .select("id, name, area_sqft, valuation, service_charge_monthly, archived, compounds(name), leases(id, active, lessee_name, gross_rent_monthly)", { count: "exact" })
      .eq("archived", false)
      .order("name")
      .range(from, to),
    sb.from("v_property_summary").select("area_sqft, valuation, active_lease_count, current_gross_rent").eq("archived", false),
  ]);

  const arr = (pageRes.data ?? []) as unknown as PropertyRow[];
  const total = pageRes.count ?? 0;
  const summary = summaryRes.data ?? [];
  const totalSqft = summary.reduce((s, p) => s + Number((p as { area_sqft: number }).area_sqft || 0), 0);
  const totalValuation = summary.reduce((s, p) => s + Number((p as { valuation: number }).valuation || 0), 0);
  const occupied = summary.filter((p) => Number((p as { active_lease_count: number }).active_lease_count) > 0).length;
  const monthlyRent = summary.reduce((s, p) => s + Number((p as { current_gross_rent: number | null }).current_gross_rent || 0), 0);

  return (
    <div>
      <PageHeader
        title="Properties"
        actions={
          has(profile, "create_property") ? (
            <Link href="/properties/new" className="btn-primary"><Plus size={14} /> New property</Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(summary.length)} hint={`${occupied} occupied · ${summary.length - occupied} vacant`} />
        <Kpi label="Total sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Total valuation" value={money(totalValuation)} />
        <Kpi label="Monthly rent (gross)" value={money(monthlyRent)} />
      </div>

      <div className="card p-0">
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Compound</th>
              <th className="text-right">Sqft</th>
              <th className="text-right">Valuation</th>
              <th className="text-right">SC / mo</th>
              <th>Status</th>
              <th>Lessee</th>
              <th className="text-right">Rent / mo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {arr.map((p) => {
              const lease = p.leases?.find((l) => l.active);
              return (
                <tr key={p.id}>
                  <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                  <td>{compoundName(p.compounds)}</td>
                  <td className="text-right">{Number(p.area_sqft).toLocaleString()}</td>
                  <td className="text-right">{money(p.valuation)}</td>
                  <td className="text-right">{money(p.service_charge_monthly)}</td>
                  <td>{lease ? <span className="badge-success">Rented</span> : <span className="badge-muted">Vacant</span>}</td>
                  <td>{lease?.lessee_name || "—"}</td>
                  <td className="text-right">{lease ? money(lease.gross_rent_monthly) : "—"}</td>
                  <td className="text-right">
                    {has(profile, "edit_property") && (
                      <Link href={`/properties/${p.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {!arr.length && <tr><td colSpan={9} className="text-center text-muted-fg py-8">No properties yet.</td></tr>}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} label="properties" />
      </div>
    </div>
  );
}
