import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("cancel_lease");
  const { id } = await params;
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  // 0) Read the current lease so we can decide whether to shorten end_date.
  const { data: existing } = await sb
    .from("leases")
    .select("property_id, end_date")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }

  // Only shorten the lease — never extend it.
  const originalEnd = String((existing as { end_date: string }).end_date);
  const newEnd = originalEnd > today ? today : originalEnd;

  // 1) Deactivate the lease, log cancellation timestamp, set end_date to actual end.
  const { data: lease, error: e1 } = await sb
    .from("leases")
    .update({
      active: false,
      cancelled_at: new Date().toISOString(),
      end_date: newEnd,
    })
    .eq("id", id)
    .select("property_id")
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  // 2) Delete only FUTURE unpaid rent rows (due or partial with due_date > today).
  //    Everything past — collected, overdue (status='due' with due_date <= today),
  //    or partially collected — stays as history.
  await sb.from("rent_collections")
    .delete()
    .eq("lease_id", id)
    .in("status", ["due", "partial"])
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
