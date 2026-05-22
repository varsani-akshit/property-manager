import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { LeaseEditForm } from "./LeaseEditForm";

export const dynamic = "force-dynamic";

export default async function EditLeasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("create_lease");
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: lease } = await sb
    .from("leases")
    .select("*, properties(id, name, service_charge_monthly, compounds(name))")
    .eq("id", id)
    .maybeSingle();
  if (!lease) notFound();

  async function update(formData: FormData) {
    "use server";
    await requirePermission("create_lease");
    const sb = await supabaseServer();
    const { error } = await sb.from("leases").update({
      lessee_name: String(formData.get("lessee_name") || "").trim(),
      lessee_contact: String(formData.get("lessee_contact") || "").trim() || null,
      lessee_doc_url: String(formData.get("lessee_doc_url") || "").trim() || null,
      start_date: String(formData.get("start_date")),
      end_date: String(formData.get("end_date")),
      gross_rent_monthly: Number(formData.get("gross_rent_monthly")),
      lessee_pays_service_charge: formData.get("lessee_pays_service_charge") === "on",
    }).eq("id", id);
    if (error) throw new Error(error.message);
    redirect(`/properties/${lease.property_id}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit lease" subtitle={`${(lease as any).properties?.compounds?.name} — ${(lease as any).properties?.name}`} />
      <LeaseEditForm lease={lease as any} action={update} />
    </div>
  );
}
