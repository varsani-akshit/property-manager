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
    const sc_payment_mode = String(formData.get("sc_payment_mode") || "we_pay");
    const payload = {
      property_id,
      lessee_name: String(formData.get("lessee_name") || "").trim(),
      lessee_contact: String(formData.get("lessee_contact") || "").trim() || null,
      lessee_doc_url: String(formData.get("lessee_doc_url") || "").trim() || null,
      start_date: String(formData.get("start_date")),
      end_date: String(formData.get("end_date")),
      gross_rent_monthly: Number(formData.get("gross_rent_monthly")),
      deposit_charged: Number(formData.get("deposit_charged") || 0),
      deposit_collected: Number(formData.get("deposit_collected") || 0),
      deposit_amount: Number(formData.get("deposit_charged") || 0), // legacy sync
      sc_payment_mode,
      // legacy boolean kept in sync for any older code paths
      lessee_pays_service_charge: sc_payment_mode !== "lessee_direct",
      created_by: user?.id,
    };
    const { data: inserted, error } = await sb.from("leases").insert(payload).select("id").maybeSingle();
    if (error) throw new Error(error.message);

    // Auto-backfill rent rows for the entire lease lifetime (start → min(end, today+6mo)).
    // Idempotent — safe even if the daily cron has already touched some months.
    if (inserted?.id) {
      await sb.rpc("backfill_lease_rents", { p_lease_id: (inserted as { id: string }).id });
    }

    // Mark SC rows for this lease period as lessee_direct if applicable
    if (sc_payment_mode === "lessee_direct") {
      await sb.rpc("daily_worker"); // ensure rows exist
      const startMonth = String(formData.get("start_date")).slice(0, 7) + "-01";
      const endMonth = String(formData.get("end_date")).slice(0, 7) + "-01";
      await sb.from("service_charges")
        .update({ status: "lessee_direct" })
        .eq("property_id", property_id)
        .eq("status", "pending")
        .gte("due_month", startMonth)
        .lte("due_month", endMonth);
    }

    redirect(`/properties/${property_id}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Put property on rent" />
      <LeaseForm properties={available} preselect={property} action={create} />
    </div>
  );
}
