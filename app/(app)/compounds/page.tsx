import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { getCurrentProfile, has } from "@/lib/permissions";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CompoundsPage() {
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();
  const { data } = await sb
    .from("compounds")
    .select("id, name, address, properties(count)")
    .order("name");

  return (
    <div>
      <PageHeader
        title="Compounds"
        subtitle="Areas / buildings that group your properties"
        actions={
          has(profile, "create_property") ? (
            <Link href="/compounds/new" className="btn-primary"><Plus size={14} /> New compound</Link>
          ) : null
        }
      />

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Address</th><th className="text-right">Properties</th><th></th></tr>
          </thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/compounds/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                </td>
                <td className="text-muted-fg">{c.address || "—"}</td>
                <td className="text-right">{c.properties?.[0]?.count ?? 0}</td>
                <td className="text-right">
                  {has(profile, "edit_property") && (
                    <Link href={`/compounds/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                  )}
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr><td colSpan={4} className="text-center text-muted-fg py-8">No compounds yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
