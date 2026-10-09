"use server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidateApp } from "@/lib/revalidate";

const CHANNELS = ["whatsapp", "sms", "email", "call", "other"] as const;
const KINDS = ["overdue", "expiry", "deposit", "other"] as const;

/** Log that a reminder went out (the message itself is sent from the user's phone / mail app). */
export async function logReminder(input: {
  lessee: string;
  leaseId?: string | null;
  kind: string;
  channel: string;
  amount?: number | null;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requirePermission("mark_rent");
  if (!input.lessee?.trim()) return { ok: false, error: "Missing lessee" };
  if (!CHANNELS.includes(input.channel as (typeof CHANNELS)[number])) return { ok: false, error: "Unknown channel" };
  const sb = await supabaseServer();
  const { error } = await sb.from("reminders").insert({
    lessee_name: input.lessee.trim(),
    lease_id: input.leaseId ?? null,
    kind: KINDS.includes(input.kind as (typeof KINDS)[number]) ? input.kind : "other",
    channel: input.channel,
    amount: input.amount ?? null,
    message: input.message.slice(0, 2000),
    sent_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidateApp("/reminders");
  return { ok: true };
}
