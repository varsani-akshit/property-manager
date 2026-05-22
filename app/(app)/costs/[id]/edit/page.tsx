import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const CATEGORIES = ["general", "maintenance", "utilities", "tax", "service_charge", "insurance", "other"];

export default async function EditCostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("add_cost");
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: cost } = await sb.from("costs").select("*").eq("id", id).maybeSingle();
  if (!cost) notFound();

  async function update(formData: FormData) {
    "use server";
    await requirePermission("add_cost");
    const sb = await supabaseServer();
    const { error } = await sb.from("costs").update({
      description: String(formData.get("description") || "").trim(),
      category: String(formData.get("category") || "general"),
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
            <select name="category" required className="input" defaultValue={cost.category}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
