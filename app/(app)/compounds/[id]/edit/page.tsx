import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditCompoundPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("edit_property");
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: c } = await sb.from("compounds").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  async function update(formData: FormData) {
    "use server";
    await requirePermission("edit_property");
    const sb = await supabaseServer();
    const { error } = await sb.from("compounds").update({
      name: String(formData.get("name") || "").trim(),
      address: String(formData.get("address") || "").trim() || null,
    }).eq("id", id);
    if (error) throw new Error(error.message);
    redirect(`/compounds/${id}`);
  }

  return (
    <div className="max-w-xl">
      <PageHeader title={`Edit: ${c.name}`} />
      <form action={update} className="card space-y-4">
        <div>
          <label className="label">Name</label>
          <input name="name" required className="input" defaultValue={c.name} />
        </div>
        <div>
          <label className="label">Address</label>
          <input name="address" className="input" defaultValue={c.address ?? ""} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary">Save changes</button>
          <Link href={`/compounds/${id}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
