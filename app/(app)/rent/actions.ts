"use server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidateApp } from "@/lib/revalidate";
import { isPaymentMethod, type PaymentKind } from "@/lib/payment-methods";

export type PaymentItem = {
  kind: PaymentKind;
  id: string;          // rent row id, cost id, or lease id (deposit)
  /** Amount to record. Omit to collect whatever is still owed on the row. */
  amount?: number;
  label?: string;      // shown in error messages
};

export type PaymentInput = {
  items: PaymentItem[];
  paid_on: string;     // yyyy-mm-dd
  method: string;
  reference?: string;
  notes?: string;
};

export type PaymentResult = { ok: boolean; recorded: number; total: number; errors: string[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Record one or many payments. Each item is logged in the payment log and its
 * row's collected total/status updated atomically (public.record_payment).
 * Items fail independently; the result lists what didn't go through.
 */
export async function recordPayments(input: PaymentInput): Promise<PaymentResult> {
  await requirePermission("mark_rent");
  const errors: string[] = [];
  if (!input.items?.length) return { ok: false, recorded: 0, total: 0, errors: ["Nothing selected."] };
  if (input.items.length > 500) return { ok: false, recorded: 0, total: 0, errors: ["Select at most 500 rows at a time."] };
  if (!ISO.test(input.paid_on ?? "")) return { ok: false, recorded: 0, total: 0, errors: ["Pick the date the money was received."] };
  if (input.paid_on > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) {
    return { ok: false, recorded: 0, total: 0, errors: ["The payment date can't be in the future."] };
  }
  if (!isPaymentMethod(input.method)) return { ok: false, recorded: 0, total: 0, errors: ["Pick how it was paid."] };

  const sb = await supabaseServer();

  // Work out "collect in full" amounts in one read per kind.
  const needRent = input.items.filter((i) => i.kind === "rent" && i.amount == null).map((i) => i.id);
  const needCost = input.items.filter((i) => i.kind === "cost" && i.amount == null).map((i) => i.id);
  const needDep = input.items.filter((i) => i.kind === "deposit" && i.amount == null).map((i) => i.id);
  const owed = new Map<string, number>();
  if (needRent.length) {
    const { data } = await sb.from("rent_collections").select("id, net_amount, collected_amount").in("id", needRent);
    for (const r of data ?? []) owed.set(`rent:${r.id}`, Number(r.net_amount) - Number(r.collected_amount));
  }
  if (needCost.length) {
    const { data } = await sb.from("costs").select("id, amount, collected_amount").in("id", needCost);
    for (const c of data ?? []) owed.set(`cost:${c.id}`, Number(c.amount) - Number(c.collected_amount));
  }
  if (needDep.length) {
    const { data } = await sb.from("leases").select("id, deposit_charged, deposit_collected").in("id", needDep);
    for (const l of data ?? []) owed.set(`deposit:${l.id}`, Number(l.deposit_charged) - Number(l.deposit_collected));
  }

  let recorded = 0;
  let total = 0;
  for (const item of input.items) {
    const amount = item.amount ?? Math.round((owed.get(`${item.kind}:${item.id}`) ?? 0) * 100) / 100;
    const name = item.label ?? item.kind;
    if (!Number.isFinite(amount) || amount <= 0) {
      if (item.amount != null) errors.push(`${name}: enter an amount above zero.`);
      continue; // already settled — nothing to collect
    }
    const { error } = await sb.rpc("record_payment", {
      p_kind: item.kind,
      p_target: item.id,
      p_amount: amount,
      p_paid_on: input.paid_on,
      p_method: input.method,
      p_reference: input.reference?.trim() || null,
      p_notes: input.notes?.trim() || null,
    });
    if (error) errors.push(`${name}: ${error.message}`);
    else { recorded += 1; total += amount; }
  }

  revalidateApp("/rent");
  revalidateApp("/payments");
  return { ok: errors.length === 0, recorded, total: Math.round(total * 100) / 100, errors };
}
