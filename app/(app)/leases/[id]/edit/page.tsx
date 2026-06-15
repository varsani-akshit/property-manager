import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
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

    const newGross = Number(formData.get("gross_rent_monthly"));
    const scMode = String(formData.get("sc_payment_mode") || "we_pay");
    const startDate = String(formData.get("start_date"));
    const endDate = String(formData.get("end_date"));
    const property_id = (lease as { property_id: string }).property_id;

    const { error } = await sb.from("leases").update({
      lessee_name: String(formData.get("lessee_name") || "").trim(),
      lessee_contact: String(formData.get("lessee_contact") || "").trim() || null,
      lessee_doc_url: String(formData.get("lessee_doc_url") || "").trim() || null,
      start_date: startDate,
      end_date: endDate,
      gross_rent_monthly: newGross,
      deposit_amount: Number(formData.get("deposit_amount") || 0),
      sc_payment_mode: scMode,
      lessee_pays_service_charge: scMode !== "lessee_direct",
    }).eq("id", id);
    if (error) throw new Error(error.message);

    // Re-sync future uncollected rent rows with new math.
    const today = new Date().toISOString().slice(0, 10);
    const sc = Number((lease as { properties?: { service_charge_monthly?: number } }).properties?.service_charge_monthly ?? 0);
    const deduction = scMode === "lessee_direct" ? 0 : sc;
    const netAmount = newGross - deduction;
    await sb.from("rent_collections").update({
      gross_amount: newGross,
      service_charge_deduction: deduction,
      net_amount: netAmount,
    }).eq("lease_id", id).eq("status", "due").gt("due_date", today);

    // Re-sync future service_charges rows for the lease months.
    if (sc > 0) {
      const startMonth = startDate.slice(0, 7) + "-01";
      const endMonth = endDate.slice(0, 7) + "-01";
      if (scMode === "lessee_direct") {
        // Move any pending future SC rows in this lease's months to lessee_direct.
        await sb.from("service_charges")
          .update({ status: "lessee_direct" })
          .eq("property_id", property_id)
          .eq("status", "pending")
          .gte("due_month", startMonth)
          .lte("due_month", endMonth);
      } else {
        // Move any lessee_direct rows back to pending (we_pay mode).
        await sb.from("service_charges")
          .update({ status: "pending" })
          .eq("property_id", property_id)
          .eq("status", "lessee_direct")
          .gte("due_month", startMonth)
          .lte("due_month", endMonth);
      }
    }

    redirect(`/properties/${property_id}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit lease" subtitle={`${(lease as any).properties?.compounds?.name} — ${(lease as any).properties?.name}`} />
      <LeaseEditForm lease={lease as any} action={update} />
    </div>
  );
}
