import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { getCurrentProfile, has, requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

async function deleteCost(formData: FormData) {
  "use server";
  await requirePermission("delete_cost");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  await sb.from("costs").delete().eq("id", id);
  revalidatePath("/costs");
}

export default async function CostsPage() {
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();

  const { data } = await sb
    .from("costs")
    .select("*, cost_allocations(allocated_amount, properties(id, name))")
    .order("incurred_on", { ascending: false })
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Costs"
        subtitle="Single property or multi-property (auto-split by sqft)"
        actions={has(profile, "add_cost") ? <Link href="/costs/new" className="btn-primary"><Plus size={14}/> Add cost</Link> : null}
      />

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Category</th>
              <th>Properties</th><th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id}>
                <td>{fmtDate(c.incurred_on)}</td>
                <td>
                  {c.description}
                  {c.is_auto_service_charge && <span className="badge-muted ml-2">auto</span>}
                </td>
                <td><span className="badge-muted">{c.category}</span></td>
                <td className="text-xs">
                  {c.cost_allocations?.length === 1
                    ? <Link href={`/properties/${c.cost_allocations[0].properties.id}`} className="hover:underline">{c.cost_allocations[0].properties.name}</Link>
                    : `${c.cost_allocations?.length ?? 0} properties (split by sqft)`}
                </td>
                <td className="text-right">{money(c.amount)}</td>
                <td className="text-right">
                  <div className="flex gap-2 justify-end">
                    {has(profile, "add_cost") && !c.is_auto_service_charge && (
                      <Link href={`/costs/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    )}
                    {has(profile, "delete_cost") && !c.is_auto_service_charge && (
                      <form action={deleteCost}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-danger text-xs">Delete</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={6} className="text-center text-muted-fg py-8">No costs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
