import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { CostForm, type LeaseOption } from "../../new/CostForm";

export const dynamic = "force-dynamic";

export default async function EditCostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("add_cost");
  const { id } = await params;
  const sb = await supabaseServer();

  const [costRes, linesRes, allocsRes, propsRes, leasesRes, catsRes] = await Promise.all([
    sb.from("costs").select("*").eq("id", id).maybeSingle(),
    sb.from("cost_line_items").select("category, amount").eq("cost_id", id).order("created_at"),
    sb.from("cost_allocations").select("property_id").eq("cost_id", id),
    sb.from("properties").select("id, name, area_sqft, compounds(name)").eq("archived", false).order("name"),
    sb.from("leases").select("id, property_id, lessee_name, properties(name)").eq("active", true).order("lessee_name"),
    sb.from("cost_categories").select("name").order("name"),
  ]);

  const cost = costRes.data;
  if (!cost) notFound();

  const lesseeByProp = new Map<string, string>();
  for (const l of leasesRes.data ?? []) lesseeByProp.set((l as { property_id: string }).property_id, (l as { lessee_name: string }).lessee_name);
  const properties = (propsRes.data ?? []).map((p) => ({
    ...(p as any),
    active_lessee: lesseeByProp.get((p as { id: string }).id) ?? null,
  }));
  const categories = (catsRes.data ?? []).map((c) => (c as { name: string }).name);
  const initialLines = (linesRes.data ?? []).map((l: any) => ({ category: l.category, amount: Number(l.amount) }));
  const initialPropertyIds = (allocsRes.data ?? []).map((a: any) => a.property_id);
  const leases: LeaseOption[] = (leasesRes.data ?? []).map((l: any) => {
    const prop = Array.isArray(l.properties) ? l.properties[0] : l.properties;
    return {
      id: l.id,
      property_id: l.property_id,
      property_name: prop?.name ?? "—",
      lessee_name: l.lessee_name,
    };
  });

  async function update(formData: FormData) {
    "use server";
    await requirePermission("add_cost");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();

    const payableByLessee = formData.get("payable_by_lessee") === "1";
    const leaseId = payableByLessee ? String(formData.get("lease_id") || "").trim() : "";
    const dueDate = payableByLessee ? String(formData.get("due_date") || "").trim() : "";
    if (payableByLessee && (!leaseId || !dueDate)) {
      throw new Error("Pick a lessee and due date");
    }

    const propIds = (formData.getAll("property_ids") as string[]).filter(Boolean);
    if (!propIds.length) throw new Error("Pick at least one property");

    const lineCount = Number(formData.get("line_count") || 0);
    const lines: { category: string; amount: number }[] = [];
    for (let i = 0; i < lineCount; i++) {
      const cat = String(formData.get(`line_category_${i}`) || "").trim().toLowerCase();
      const amt = Number(formData.get(`line_amount_${i}`));
      if (cat && amt > 0) lines.push({ category: cat, amount: amt });
    }
    if (!lines.length) throw new Error("Add at least one line item with a positive amount");

    const uniqueCats = Array.from(new Set(lines.map((l) => l.category)));
    for (const cat of uniqueCats) {
      await sb.from("cost_categories").upsert({ name: cat, created_by: user?.id ?? null }, { onConflict: "name", ignoreDuplicates: true });
    }

    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
    const primaryCategory = lines[0].category;

    // Preserve existing collection state when toggling stays on
    const wasPayable = Boolean((cost as any).payable_by_lessee);
    const keepCollection = wasPayable && payableByLessee;
    const update_payload: Record<string, unknown> = {
      description: String(formData.get("description") || "").trim(),
      category: primaryCategory,
      amount: totalAmount,
      incurred_on: String(formData.get("incurred_on")),
      notes: String(formData.get("notes") || "").trim() || null,
      payable_by_lessee: payableByLessee,
      lease_id: payableByLessee ? leaseId : null,
      due_date: payableByLessee ? dueDate : null,
    };
    if (!keepCollection) {
      update_payload.collection_status = payableByLessee ? "due" : null;
      update_payload.collected_amount = 0;
      update_payload.collected_at = null;
      update_payload.collected_by = null;
    }
    const { error: e1 } = await sb.from("costs").update(update_payload).eq("id", id);
    if (e1) throw new Error(e1.message);

    // Replace line items wholesale
    await sb.from("cost_line_items").delete().eq("cost_id", id);
    const { error: e2 } = await sb.from("cost_line_items").insert(
      lines.map((l) => ({ cost_id: id, category: l.category, amount: l.amount }))
    );
    if (e2) throw new Error(e2.message);

    // Re-allocate to properties (replace)
    await sb.from("cost_allocations").delete().eq("cost_id", id);
    if (propIds.length === 1) {
      await sb.from("cost_allocations").insert({
        cost_id: id,
        property_id: propIds[0],
        allocated_amount: totalAmount,
      });
    } else {
      const { error: e3 } = await sb.rpc("allocate_cost_by_sqft", {
        p_cost_id: id,
        p_property_ids: propIds,
      });
      if (e3) throw new Error(e3.message);
    }

    redirect("/costs");
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit cost" />
      <CostForm
        properties={properties}
        leases={leases}
        categories={categories}
        action={update}
        initial={{
          description: cost.description,
          incurred_on: cost.incurred_on,
          notes: cost.notes ?? "",
          lines: initialLines,
          propertyIds: initialPropertyIds,
          payable_by_lessee: Boolean((cost as any).payable_by_lessee),
          lease_id: (cost as any).lease_id ?? null,
          due_date: (cost as any).due_date ?? null,
        }}
      />
    </div>
  );
}
