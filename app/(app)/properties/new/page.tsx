import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function NewPropertyPage() {
  await requirePermission("create_property");
  const sb = await supabaseServer();
  const { data: compounds } = await sb.from("compounds").select("id, name").order("name");

  async function create(formData: FormData) {
    "use server";
    await requirePermission("create_property");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const payload = {
      compound_id: String(formData.get("compound_id")),
      name: String(formData.get("name") || "").trim(),
      area_sqft: Number(formData.get("area_sqft")),
      valuation: Number(formData.get("valuation") || 0),
      service_charge_monthly: Number(formData.get("service_charge_monthly") || 0),
      service_charge_start_date: String(formData.get("service_charge_start_date") || "") || null,
      deed_url: String(formData.get("deed_url") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
      created_by: user?.id,
    };
    const { error } = await sb.from("properties").insert(payload);
    if (error) throw new Error(error.message);
    redirect("/properties");
  }

  if (!compounds?.length) {
    return (
      <div className="max-w-xl">
        <PageHeader title="New property" />
        <div className="card">
          <p className="text-sm">You need to create a compound first.</p>
          <Link href="/compounds/new" className="btn-primary mt-3 inline-flex">Create compound</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="New property" />
      <form action={create} className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Compound</label>
            <select name="compound_id" required className="input">
              {compounds.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Property name</label>
            <input name="name" required className="input" placeholder="e.g. Block A, Unit 12" />
          </div>
          <div>
            <label className="label">Area (sqft)</label>
            <input name="area_sqft" required type="number" step="0.01" min="0.01" className="input" />
          </div>
          <div>
            <label className="label">Valuation (KES)</label>
            <input name="valuation" type="number" step="0.01" min="0" className="input" defaultValue={0} />
          </div>
          <div>
            <label className="label">Service charge / month (KES)</label>
            <input name="service_charge_monthly" type="number" step="0.01" min="0" className="input" defaultValue={0} />
          </div>
          <div>
            <label className="label">Service charge start date</label>
            <input name="service_charge_start_date" type="date" className="input" />
          </div>
        </div>
        <div>
          <label className="label">Deed link (Google Drive URL)</label>
          <input name="deed_url" type="url" className="input" placeholder="https://drive.google.com/..." />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="input" rows={3} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary">Create property</button>
          <Link href="/properties" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
