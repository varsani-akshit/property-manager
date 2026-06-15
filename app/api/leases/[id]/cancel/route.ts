import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("cancel_lease");
  const { id } = await params;
  const sb = await supabaseServer();

  // 1) Deactivate the lease (don't delete — preserve history).
  //    Also bring end_date forward to today so the lease timeline reflects actual tenure.
  const today = new Date().toISOString().slice(0, 10);
  const { data: lease, error: e1 } = await sb
    .from("leases")
    .update({
      active: false,
      cancelled_at: new Date().toISOString(),
      end_date: today, // shorten lease to actual end
    })
    .eq("id", id)
    .select("property_id")
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  // 2) Clean up future uncollected rent rows for this lease — they're no longer valid.
  //    Past dues (overdue) and already-collected rows are preserved as history.
  await sb.from("rent_collections")
    .delete()
    .eq("lease_id", id)
    .eq("status", "due")
    .gt("due_date", today);

  // 3) Flip future "lessee_direct" SC rows back to "pending" since the property
  //    is now vacant (no lessee covering the SC).
  if (lease?.property_id) {
    await sb.from("service_charges")
      .update({ status: "pending" })
      .eq("property_id", lease.property_id)
      .eq("status", "lessee_direct")
      .gte("due_month", today.slice(0, 7) + "-01");
  }

  const url = new URL(`/properties/${lease?.property_id ?? ""}`, req.url);
  return NextResponse.redirect(url, { status: 303 });
}
