import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CostForm } from "./CostForm";

export default async function NewCostPage() {
  await requirePermission("add_cost");
  const sb = await supabaseServer();
  const { data: properties } = await sb
    .from("properties")
    .select("id, name, area_sqft, compounds(name)")
    .eq("archived", false)
    .order("name");

  async function create(formData: FormData) {
    "use server";
    await requirePermission("add_cost");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();

    const propIds = (formData.getAll("property_ids") as string[]).filter(Boolean);
    if (!propIds.length) throw new Error("Pick at least one property");

    const { data: cost, error: e1 } = await sb.from("costs").insert({
      description: String(formData.get("description") || "").trim(),
      category: String(formData.get("category") || "general"),
      amount: Number(formData.get("amount")),
      incurred_on: String(formData.get("incurred_on")),
      notes: String(formData.get("notes") || "").trim() || null,
      created_by: user?.id,
    }).select("id").maybeSingle();
    if (e1 || !cost) throw new Error(e1?.message || "insert failed");

    if (propIds.length === 1) {
      // single property — full amount
      await sb.from("cost_allocations").insert({
        cost_id: cost.id,
        property_id: propIds[0],
        allocated_amount: Number(formData.get("amount")),
      });
    } else {
      // multi-property — split by sqft via DB function
      const { error: e2 } = await sb.rpc("allocate_cost_by_sqft", {
        p_cost_id: cost.id,
        p_property_ids: propIds,
      });
      if (e2) throw new Error(e2.message);
    }

    redirect("/costs");
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add cost" />
      <CostForm properties={properties ?? []} action={create} />
    </div>
  );
}
