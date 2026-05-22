import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function NewCompoundPage() {
  await requirePermission("create_property");

  async function create(formData: FormData) {
    "use server";
    await requirePermission("create_property");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("compounds").insert({
      name: String(formData.get("name") || "").trim(),
      address: String(formData.get("address") || "").trim() || null,
      created_by: user?.id,
    });
    if (error) throw new Error(error.message);
    redirect("/compounds");
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="New compound" />
      <form action={create} className="card space-y-4">
        <div>
          <label className="label">Compound / area name</label>
          <input name="name" required className="input" placeholder="e.g. Sunrise Apartments, Westlands" />
        </div>
        <div>
          <label className="label">Address (optional)</label>
          <input name="address" className="input" />
        </div>
        <button className="btn-primary">Create compound</button>
      </form>
    </div>
  );
}
