import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditCostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("add_cost");
  const { id } = await params;
  const sb = await supabaseServer();
  const [costRes, catsRes] = await Promise.all([
    sb.from("costs").select("*").eq("id", id).maybeSingle(),
    sb.from("cost_categories").select("name").order("name"),
  ]);
  const cost = costRes.data;
  if (!cost) notFound();
  const categories = (catsRes.data ?? []).map((c) => (c as { name: string }).name);

  async function update(formData: FormData) {
    "use server";
    await requirePermission("add_cost");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const category = String(formData.get("category") || "").trim().toLowerCase();
    if (!category) throw new Error("Category is required");
    await sb.from("cost_categories").upsert({ name: category, created_by: user?.id ?? null }, { onConflict: "name", ignoreDuplicates: true });

    const { error } = await sb.from("costs").update({
      description: String(formData.get("description") || "").trim(),
      category,
      incurred_on: String(formData.get("incurred_on")),
      notes: String(formData.get("notes") || "").trim() || null,
    }).eq("id", id);
    if (error) throw new Error(error.message);
    redirect("/costs");
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit cost" subtitle="To change the amount or split, delete this cost and re-add it." />
      <form action={update} className="card space-y-4">
        <div>
          <label className="label">Description</label>
          <input name="description" required className="input" defaultValue={cost.description} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Category</label>
            <input
              name="category"
              required
              list="cost-categories-edit"
              className="input"
              defaultValue={cost.category}
            />
            <datalist id="cost-categories-edit">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <p className="text-xs text-muted-fg mt-1">Type a new category to create it.</p>
          </div>
          <div>
            <label className="label">Date</label>
            <input name="incurred_on" type="date" required className="input" defaultValue={cost.incurred_on} />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="input" rows={2} defaultValue={cost.notes ?? ""} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary">Save changes</button>
          <Link href="/costs" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
