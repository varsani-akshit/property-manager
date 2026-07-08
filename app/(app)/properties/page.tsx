import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { SearchBar } from "@/components/SearchBar";
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

// Human/natural alphanumeric sort — "Godown No. 2" before "Godown No. 10".
const natCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const profile = await guardView("view_properties");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const page = parsePage(sp.page);

  const sb = await supabaseServer();

  // Resolve search-filter → property IDs (any of: property name / compound / active lessee)
  let allowedPropertyIds: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [{ data: byProp }, { data: byCompound }, { data: byLease }] = await Promise.all([
      sb.from("properties").select("id").eq("archived", false).ilike("name", like),
      sb.from("properties").select("id, compounds!inner(name)").eq("archived", false).ilike("compounds.name", like),
      sb.from("leases").select("property_id").eq("active", true).ilike("lessee_name", like),
    ]);
    const ids = new Set<string>();
    for (const r of byProp ?? []) ids.add((r as { id: string }).id);
    for (const r of byCompound ?? []) ids.add((r as { id: string }).id);
    for (const r of byLease ?? []) ids.add((r as { property_id: string }).property_id);
    allowedPropertyIds = Array.from(ids);
    if (allowedPropertyIds.length === 0) allowedPropertyIds = ["00000000-0000-0000-0000-000000000000"];
  }

  // Fetch ALL matching rows (small dataset, ~73 total) so we can sort naturally
  // by (compound, property) in JS and then paginate.
  let baseQ = sb.from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived, compounds(name), leases(id, active, lessee_name, gross_rent_monthly)")
    .eq("archived", false);
  if (allowedPropertyIds) baseQ = baseQ.in("id", allowedPropertyIds);
  const allRes = await baseQ;

  const all = (allRes.data ?? []) as unknown as PropertyRow[];
  all.sort((a, b) => {
    const c = natCollator.compare(compoundName(a.compounds), compoundName(b.compounds));
    return c !== 0 ? c : natCollator.compare(a.name, b.name);
  });
  const total = all.length;
  const start = (page - 1) * PAGE_SIZE;
  const arr = all.slice(start, start + PAGE_SIZE);

  // Summary always reflects the search filter so KPIs match what's shown.
  let summaryQ = sb.from("v_property_summary")
    .select("area_sqft, valuation, active_lease_count, current_gross_rent")
    .eq("archived", false);
  if (allowedPropertyIds) summaryQ = summaryQ.in("id", allowedPropertyIds);
  const summaryRes = await summaryQ;
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

      <SearchBar placeholder="Search by property, compound, or lessee…" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(summary.length)} hint={`${occupied} occupied · ${summary.length - occupied} vacant`} />
        <Kpi label="Total sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Total valuation" value={money(totalValuation)} />
        <Kpi label="Monthly rent (gross)" value={money(monthlyRent)} />
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Compound</th>
                <th>Lessee</th>
                <th className="text-right">Rent / mo</th>
                <th className="text-right">Sqft</th>
                <th className="text-right">Valuation</th>
                <th className="text-right">SC / mo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {arr.map((p) => {
                const lease = p.leases?.find((l) => l.active);
                return (
                  <tr key={p.id} className="cursor-pointer">
                    <td>
                      <Link href={`/properties/${p.id}`} className="block font-medium">{p.name}</Link>
                    </td>
                    <td><Link href={`/properties/${p.id}`} className="block">{compoundName(p.compounds)}</Link></td>
                    <td><Link href={`/properties/${p.id}`} className="block">{lease?.lessee_name || "—"}</Link></td>
                    <td className="text-right"><Link href={`/properties/${p.id}`} className="block">{lease ? money(lease.gross_rent_monthly) : "—"}</Link></td>
                    <td className="text-right"><Link href={`/properties/${p.id}`} className="block">{Number(p.area_sqft).toLocaleString()}</Link></td>
                    <td className="text-right"><Link href={`/properties/${p.id}`} className="block">{money(p.valuation)}</Link></td>
                    <td className="text-right"><Link href={`/properties/${p.id}`} className="block">{money(p.service_charge_monthly)}</Link></td>
                    <td><Link href={`/properties/${p.id}`} className="block">{lease ? <span className="badge-success">Rented</span> : <span className="badge-muted">Vacant</span>}</Link></td>
                  </tr>
                );
              })}
              {!arr.length && <tr><td colSpan={8} className="text-center text-muted-fg py-8">{q ? "No properties match." : "No properties yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} label="properties" searchParams={sp} />
      </div>
    </div>
  );
}
