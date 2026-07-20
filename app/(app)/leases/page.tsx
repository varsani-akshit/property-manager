import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { SearchBar } from "@/components/SearchBar";
import { money } from "@/lib/format";
import { guardView } from "@/lib/guard";
import { has } from "@/lib/permissions";
import Link from "next/link";
import { Plus } from "lucide-react";
import { LeasesTable, type LeaseRow } from "./LeasesTable";

export const dynamic = "force-dynamic";

function compoundName(c: { name: string } | { name: string }[] | null): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await guardView("view_leases");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";

  const sb = await supabaseServer();

  // Resolve search → set of allowed lease IDs
  let allowedIds: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [{ data: byLessee }, { data: byProp }, { data: byCompound }] = await Promise.all([
      sb.from("leases").select("id").ilike("lessee_name", like),
      sb.from("leases").select("id, properties!inner(name)").ilike("properties.name", like),
      sb.from("leases").select("id, properties!inner(compounds!inner(name))").ilike("properties.compounds.name", like),
    ]);
    const set = new Set<string>();
    for (const r of byLessee ?? []) set.add((r as { id: string }).id);
    for (const r of byProp ?? []) set.add((r as { id: string }).id);
    for (const r of byCompound ?? []) set.add((r as { id: string }).id);
    allowedIds = Array.from(set);
    if (!allowedIds.length) allowedIds = ["00000000-0000-0000-0000-000000000000"];
  }

  let leasesQ = sb.from("leases")
    .select("id, active, lessee_name, lessee_contact, start_date, end_date, gross_rent_monthly, properties(id, name, compounds(name))");
  if (allowedIds) leasesQ = leasesQ.in("id", allowedIds);
  const leasesRes = await leasesQ;

  const rows: LeaseRow[] = ((leasesRes.data ?? []) as any[]).map((l) => {
    const p = Array.isArray(l.properties) ? l.properties[0] : l.properties;
    return {
      id: l.id,
      active: l.active,
      lessee_name: l.lessee_name,
      lessee_contact: l.lessee_contact,
      start_date: l.start_date,
      end_date: l.end_date,
      gross_rent_monthly: Number(l.gross_rent_monthly),
      property_name: p?.name ?? "—",
      compound_name: compoundName(p?.compounds ?? null),
    };
  });

  const active = rows.filter((l) => l.active);
  const monthlyRent = active.reduce((s, l) => s + l.gross_rent_monthly, 0);
  const now = Date.now();
  const expiring60 = active.filter((l) => {
    const d = (new Date(l.end_date).getTime() - now) / 86400000;
    return d >= 0 && d <= 60;
  }).length;
  const past = rows.length - active.length;

  return (
    <div>
      <PageHeader
        title="Leases"
        right={<SearchBar placeholder="Search lessee, property, compound…" />}
        actions={has(profile, "create_lease") ? <Link href="/leases/new" className="btn-primary"><Plus size={14}/> New lease</Link> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Active leases" value={String(active.length)} />
        <Kpi label="Monthly rent (gross)" value={money(monthlyRent)} />
        <Kpi label="Expiring ≤ 60 days" value={String(expiring60)} />
        <Kpi label="Past leases" value={String(Math.max(0, past))} />
      </div>

      <LeasesTable rows={rows} />
    </div>
  );
}
