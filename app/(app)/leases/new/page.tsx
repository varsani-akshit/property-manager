import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LeaseForm } from "./LeaseForm";

export default async function NewLeasePage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  await requirePermission("create_lease");
  const { property } = await searchParams;
  const sb = await supabaseServer();

  // Available = no active lease and not archived
  const { data: properties } = await sb
    .from("properties")
    .select("id, name, area_sqft, service_charge_monthly, compounds(name), leases(active)")
    .eq("archived", false)
    .order("name");

  const available = (properties ?? []).filter((p: any) => !p.leases?.some((l: any) => l.active));

  async function create(formData: FormData) {
    "use server";
    await requirePermission("create_lease");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const property_id = String(formData.get("property_id"));
    const payload = {
      property_id,
      lessee_name: String(formData.get("lessee_name") || "").trim(),
      lessee_contact: String(formData.get("lessee_contact") || "").trim() || null,
      lessee_doc_url: String(formData.get("lessee_doc_url") || "").trim() || null,
      start_date: String(formData.get("start_date")),
      end_date: String(formData.get("end_date")),
      gross_rent_monthly: Number(formData.get("gross_rent_monthly")),
      lessee_pays_service_charge: formData.get("lessee_pays_service_charge") === "on",
      created_by: user?.id,
    };
    const { error } = await sb.from("leases").insert(payload);
    if (error) throw new Error(error.message);
    redirect(`/properties/${property_id}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Put property on rent" />
      <LeaseForm properties={available} preselect={property} action={create} />
    </div>
  );
}
