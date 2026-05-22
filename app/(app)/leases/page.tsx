import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { money, fmtDate } from "@/lib/format";
import { guardView } from "@/lib/guard";
import { has } from "@/lib/permissions";
import Link from "next/link";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

type LeaseRow = {
  id: string;
  active: boolean;
  lessee_name: string;
  lessee_contact: string | null;
  start_date: string;
  end_date: string;
  gross_rent_monthly: number;
  properties: { id: string; name: string; compounds: { name: string } | { name: string }[] | null } | { id: string; name: string; compounds: { name: string } | { name: string }[] | null }[] | null;
};

function compoundName(c: { name: string } | { name: string }[] | null): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}
function propertyOf(l: LeaseRow): { id: string; name: string; compounds: { name: string } | { name: string }[] | null } | null {
  if (!l.properties) return null;
  return Array.isArray(l.properties) ? l.properties[0] : l.properties;
}

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await guardView("view_leases");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();

  // Page of leases + aggregate summary across all leases.
  const [pageRes, activeSummary] = await Promise.all([
    sb.from("leases")
      .select("id, active, lessee_name, lessee_contact, start_date, end_date, gross_rent_monthly, properties(id, name, compounds(name))", { count: "exact" })
      .order("active", { ascending: false })
      .order("start_date", { ascending: false })
      .range(from, to),
    sb.from("leases").select("id, end_date, gross_rent_monthly, active").eq("active", true),
  ]);

  const arr = (pageRes.data ?? []) as unknown as LeaseRow[];
  const total = pageRes.count ?? 0;
  const active = (activeSummary.data ?? []) as Array<{ end_date: string; gross_rent_monthly: number }>;
  const monthlyRent = active.reduce((s, l) => s + Number(l.gross_rent_monthly || 0), 0);
  const now = Date.now();
  const expiring60 = active.filter((l) => {
    const d = (new Date(l.end_date).getTime() - now) / 86400000;
    return d >= 0 && d <= 60;
  }).length;

  // Past leases = total - active count
  const past = total - active.length;

  return (
    <div>
      <PageHeader
        title="Leases"
        actions={has(profile, "create_lease") ? <Link href="/leases/new" className="btn-primary"><Plus size={14}/> New lease</Link> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Active leases" value={String(active.length)} />
        <Kpi label="Monthly rent (gross)" value={money(monthlyRent)} />
        <Kpi label="Expiring ≤ 60 days" value={String(expiring60)} />
        <Kpi label="Past leases" value={String(past)} />
      </div>

      <div className="card p-0">
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Property</th><th>Lessee</th><th>Contact</th>
              <th>Start</th><th>End</th>
              <th className="text-right">Gross rent</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {arr.map((l) => {
              const p = propertyOf(l);
              return (
                <tr key={l.id}>
                  <td>
                    {p && <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>}
                    <div className="text-xs text-muted-fg">{compoundName(p?.compounds ?? null)}</div>
                  </td>
                  <td>{l.lessee_name}</td>
                  <td>{l.lessee_contact || "—"}</td>
                  <td>{fmtDate(l.start_date)}</td>
                  <td>{fmtDate(l.end_date)}</td>
                  <td className="text-right">{money(l.gross_rent_monthly)}</td>
                  <td>{l.active ? <span className="badge-success">Active</span> : <span className="badge-muted">Ended</span>}</td>
                  <td className="text-right">
                    {has(profile, "create_lease") && l.active && (
                      <Link href={`/leases/${l.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {!arr.length && <tr><td colSpan={8} className="text-center text-muted-fg py-8">No leases yet.</td></tr>}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} label="leases" />
      </div>
    </div>
  );
}
