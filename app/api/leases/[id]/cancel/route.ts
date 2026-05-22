import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("cancel_lease");
  const { id } = await params;
  const sb = await supabaseServer();

  // 1) Deactivate the lease (don't delete — preserve history)
  const { data: lease, error: e1 } = await sb
    .from("leases")
    .update({ active: false, cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .select("property_id")
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  // 2) Clean up future uncollected rent rows for this lease — they're no longer valid.
  //    Past dues (overdue) and already-collected rows are preserved as history.
  const today = new Date().toISOString().slice(0, 10);
  await sb.from("rent_collections")
    .delete()
    .eq("lease_id", id)
    .eq("status", "due")
    .gt("due_date", today);

  const url = new URL(`/properties/${lease?.property_id ?? ""}`, req.url);
  return NextResponse.redirect(url, { status: 303 });
}
