import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
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

export default async function PropertiesPage() {
  const profile = await guardView("view_properties");
  const sb = await supabaseServer();

  const { data: props } = await sb
    .from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived, compounds(name), leases(id, active, lessee_name, gross_rent_monthly)")
    .eq("archived", false)
    .order("name");

  const arr = (props ?? []) as unknown as PropertyRow[];
  const totalSqft = arr.reduce((s, p) => s + Number(p.area_sqft || 0), 0);
  const totalValuation = arr.reduce((s, p) => s + Number(p.valuation || 0), 0);
  const occupied = arr.filter((p) => p.leases?.some((l) => l.active)).length;
  const monthlyRent = arr.reduce((s, p) => s + Number(p.leases?.find((l) => l.active)?.gross_rent_monthly ?? 0), 0);

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
        <Kpi label="Properties" value={String(arr.length)} hint={`${occupied} occupied · ${arr.length - occupied} vacant`} />
        <Kpi label="Total sqft" value={totalSqft.toLocaleString()} />
        <Kpi label="Total valuation" value={money(totalValuation)} />
        <Kpi label="Monthly rent (gross)" value={money(monthlyRent)} />
      </div>

      <div className="card p-0">
        <table className="table">
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
        </table>
      </div>
    </div>
  );
}
