import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPaymentMethod, type PaymentKind } from "./payment-methods";

/** Read the shared payment fields (see components/PaymentFields) from a form. */
export function paymentFieldsFrom(fd: FormData) {
  const paid_on = String(fd.get("paid_on") ?? "") || new Date().toISOString().slice(0, 10);
  const methodRaw = String(fd.get("method") ?? "other");
  return {
    paid_on,
    method: isPaymentMethod(methodRaw) ? methodRaw : "other",
    reference: String(fd.get("reference") ?? "").trim() || null,
    notes: String(fd.get("pay_notes") ?? "").trim() || null,
  };
}

/**
 * Set a row's collected total to an exact figure, logging the difference in the
 * payment log (an adjustment when it goes down). Returns an error message or null.
 */
export async function setCollectedTotal(
  sb: SupabaseClient,
  kind: PaymentKind,
  id: string,
  total: number,
  fields: ReturnType<typeof paymentFieldsFrom>
): Promise<string | null> {
  const { error } = await sb.rpc("set_collected_total", {
    p_kind: kind,
    p_target: id,
    p_total: Math.round(total * 100) / 100,
    p_paid_on: fields.paid_on,
    p_method: fields.method,
    p_reference: fields.reference,
    p_notes: fields.notes,
  });
  return error?.message ?? null;
}
