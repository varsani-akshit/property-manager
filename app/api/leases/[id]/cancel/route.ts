import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("cancel_lease");
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: lease, error: e1 } = await sb
    .from("leases")
    .update({ active: false, cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .select("property_id")
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });
  const url = new URL(`/properties/${lease?.property_id ?? ""}`, req.url);
  return NextResponse.redirect(url, { status: 303 });
}
