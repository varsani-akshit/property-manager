import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { getCurrentProfile, has } from "@/lib/permissions";
import { money } from "@/lib/format";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();

  const { data: props } = await sb
    .from("properties")
    .select("id, name, area_sqft, valuation, service_charge_monthly, archived, compounds(name), leases(id, active, lessee_name, gross_rent_monthly)")
    .eq("archived", false)
    .order("name");

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

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Compound</th>
              <th className="text-right">Sqft</th>
              <th className="text-right">Valuation</th>
              <th className="text-right">Service charge / mo</th>
              <th>Status</th>
              <th>Lessee</th>
              <th className="text-right">Rent / mo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {props?.map((p: any) => {
              const lease = p.leases?.find((l: any) => l.active);
              return (
                <tr key={p.id}>
                  <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                  <td>{p.compounds?.name}</td>
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
            {!props?.length && <tr><td colSpan={9} className="text-center text-muted-fg py-8">No properties yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
