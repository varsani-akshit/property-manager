import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { getCurrentProfile, has } from "@/lib/permissions";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeasesPage() {
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();
  const { data } = await sb
    .from("leases")
    .select("*, properties(id, name, compounds(name))")
    .order("active", { ascending: false })
    .order("start_date", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Leases"
        actions={has(profile, "create_lease") ? <Link href="/leases/new" className="btn-primary"><Plus size={14}/> New lease</Link> : null}
      />
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Property</th><th>Lessee</th><th>Contact</th>
              <th>Start</th><th>End</th>
              <th className="text-right">Gross rent</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((l: any) => (
              <tr key={l.id}>
                <td><Link href={`/properties/${l.properties?.id}`} className="font-medium hover:underline">{l.properties?.name}</Link><div className="text-xs text-muted-fg">{l.properties?.compounds?.name}</div></td>
                <td>{l.lessee_name}</td>
                <td>{l.lessee_contact}</td>
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
            ))}
            {!data?.length && <tr><td colSpan={8} className="text-center text-muted-fg py-8">No leases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
