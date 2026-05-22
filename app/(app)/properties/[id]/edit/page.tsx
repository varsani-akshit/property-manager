import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { DriveUpload } from "@/components/DriveUpload";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("edit_property");
  const { id } = await params;
  const sb = await supabaseServer();
  const [{ data: prop }, { data: compounds }] = await Promise.all([
    sb.from("properties").select("*").eq("id", id).maybeSingle(),
    sb.from("compounds").select("id, name").order("name"),
  ]);
  if (!prop) notFound();

  async function update(formData: FormData) {
    "use server";
    await requirePermission("edit_property");
    const sb = await supabaseServer();
    const { error } = await sb.from("properties").update({
      compound_id: String(formData.get("compound_id")),
      name: String(formData.get("name") || "").trim(),
      area_sqft: Number(formData.get("area_sqft")),
      valuation: Number(formData.get("valuation") || 0),
      service_charge_monthly: Number(formData.get("service_charge_monthly") || 0),
      service_charge_start_date: String(formData.get("service_charge_start_date") || "") || null,
      deed_url: String(formData.get("deed_url") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
    }).eq("id", id);
    if (error) throw new Error(error.message);
    redirect(`/properties/${id}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={`Edit: ${prop.name}`} />
      <form action={update} className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Compound</label>
            <select name="compound_id" required className="input" defaultValue={prop.compound_id}>
              {compounds?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Property name</label>
            <input name="name" required className="input" defaultValue={prop.name} />
          </div>
          <div>
            <label className="label">Area (sqft)</label>
            <input name="area_sqft" required type="number" step="0.01" min="0.01" className="input" defaultValue={prop.area_sqft} />
          </div>
          <div>
            <label className="label">Valuation (KES)</label>
            <input name="valuation" type="number" step="0.01" min="0" className="input" defaultValue={prop.valuation} />
          </div>
          <div>
            <label className="label">Service charge / month (KES)</label>
            <input name="service_charge_monthly" type="number" step="0.01" min="0" className="input" defaultValue={prop.service_charge_monthly} />
          </div>
          <div>
            <label className="label">Service charge start date</label>
            <input name="service_charge_start_date" type="date" className="input" defaultValue={prop.service_charge_start_date ?? ""} />
          </div>
        </div>
        <DriveUpload name="deed_url" kind="deed" slug={prop.name} initialUrl={prop.deed_url} label="Property deed" />
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="input" rows={3} defaultValue={prop.notes ?? ""} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary">Save changes</button>
          <Link href={`/properties/${id}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
