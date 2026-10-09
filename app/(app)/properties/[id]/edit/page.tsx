import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { revalidateApp } from "@/lib/revalidate";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { CompoundPicker } from "@/components/CompoundPicker";

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
    const newSC = Number(formData.get("service_charge_monthly") || 0);

    const { error } = await sb.from("properties").update({
      compound_id: String(formData.get("compound_id")),
      name: String(formData.get("name") || "").trim(),
      area_sqft: Number(formData.get("area_sqft")),
      valuation: Number(formData.get("valuation") || 0),
      service_charge_monthly: newSC,
      service_charge_start_date: String(formData.get("service_charge_start_date") || "") || null,
      deed_url: String(formData.get("deed_url") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
    }).eq("id", id);
    if (error) throw new Error(error.message);

    if (newSC === 0) {
      // Property no longer has SC — clear future pending/lessee_direct SC rows for this property.
      const today = new Date().toISOString().slice(0, 10);
      await sb.from("service_charges")
        .delete()
        .eq("property_id", id)
        .in("status", ["pending", "lessee_direct"])
        .gte("due_month", today);
    } else {
      // Update pending rows to new amount (paid ones stay frozen as historical).
      const today = new Date().toISOString().slice(0, 10);
      await sb.from("service_charges")
        .update({ amount: newSC })
        .eq("property_id", id)
        .in("status", ["pending", "lessee_direct"])
        .gte("due_month", today);
    }

    revalidateApp();

    redirect(`/properties/${id}`);
  }

  return (
    <div className="[&>*:not(:first-child)]:max-w-2xl">
      <PageHeader crumbs={[{ label: "Properties", href: "/properties" }, { label: prop.name, href: `/properties/${prop.id}` }, { label: "Edit" }]} />
      <form action={update} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Compound</label>
            <CompoundPicker
              compounds={(compounds ?? []) as { id: string; name: string }[]}
              initial={prop.compound_id}
            />
          </div>
          <div>
            <label className="label" htmlFor="f-name">Property name</label>
            <input id="f-name" name="name" required className="input" defaultValue={prop.name} />
          </div>
          <div>
            <label className="label" htmlFor="f-area_sqft">Area (sqft)</label>
            <input id="f-area_sqft" name="area_sqft" required type="number" step="0.01" min="0.01" className="input" defaultValue={prop.area_sqft} />
          </div>
          <div>
            <label className="label" htmlFor="f-valuation">Valuation (KES)</label>
            <input id="f-valuation" name="valuation" type="number" step="0.01" min="0" className="input" defaultValue={prop.valuation} />
          </div>
          <div>
            <label className="label" htmlFor="f-service_charge_monthly">Service charge / month (KES)</label>
            <input id="f-service_charge_monthly" name="service_charge_monthly" type="number" step="0.01" min="0" className="input" defaultValue={prop.service_charge_monthly} />
          </div>
          <div>
            <label className="label" htmlFor="f-service_charge_start_date">Service charge start date</label>
            <input id="f-service_charge_start_date" name="service_charge_start_date" type="date" className="input" defaultValue={prop.service_charge_start_date ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="f-deed_url">Deed link (Google Drive URL)</label>
          <input id="f-deed_url" name="deed_url" type="url" className="input" defaultValue={prop.deed_url ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="f-notes">Notes</label>
          <textarea id="f-notes" name="notes" className="input" rows={3} defaultValue={prop.notes ?? ""} />
        </div>
        <div className="flex gap-2">
          <SubmitButton>Save changes</SubmitButton>
          <Link href={`/properties/${id}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
