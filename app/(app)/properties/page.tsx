import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { SearchBar } from "@/components/SearchBar";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";
import { PropertiesTable, type PropertyTableRow } from "./PropertiesTable";

export const dynamic = "force-dynamic";

type PropertyDbRow = {
  id: string;
  name: string;
  area_sqft: number;
  valuation: number;
  service_charge_monthly: number;
  archived: boolean;
  compounds: { name: string } | { name: string }[] | null;
  leases: { id: string; active: boolean; lessee_name: string; gross_rent_monthly: number }[] | null;
};

function compoundName(c: PropertyDbRow["compounds"]): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await guardView("view_properties");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";

  const sb = await supabaseServer();

  // Search filter: property name / compound name / active lessee name
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

  let baseQ = sb.from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived, compounds(name), leases(id, active, lessee_name, gross_rent_monthly)")
    .eq("archived", false);
  if (allowedPropertyIds) baseQ = baseQ.in("id", allowedPropertyIds);
  const allRes = await baseQ;

  const rows: PropertyTableRow[] = ((allRes.data ?? []) as unknown as PropertyDbRow[]).map((p) => {
    const lease = p.leases?.find((l) => l.active) ?? null;
    return {
      id: p.id,
      name: p.name,
      compound_name: compoundName(p.compounds),
      active_lessee: lease?.lessee_name ?? null,
      active_rent: lease ? Number(lease.gross_rent_monthly) : null,
      area_sqft: Number(p.area_sqft),
      valuation: Number(p.valuation),
      service_charge_monthly: Number(p.service_charge_monthly),
      rented: !!lease,
    };
  });

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
        right={<SearchBar placeholder="Search property, compound, lessee…" />}
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

      <PropertiesTable rows={rows} />
    </div>
  );
}
