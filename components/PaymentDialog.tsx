"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./ui/Dialog";
import { Loader } from "./Loader";
import { money } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/payment-methods";
import { recordPayments, type PaymentItem } from "@/app/(app)/rent/actions";

export type PayTarget = PaymentItem & { label: string; owed: number };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Record what was received. With one row you can enter a part-payment; with
 * several, each row is collected in full under the same date, method and
 * reference (e.g. one M-Pesa payment that covers three months).
 */
export function PaymentDialog({
  open,
  targets,
  onClose,
  onDone,
}: {
  open: boolean;
  targets: PayTarget[];
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const router = useRouter();
  const single = targets.length === 1;
  const owedTotal = targets.reduce((s, t) => s + t.owed, 0);

  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setAmount(single ? String(targets[0]!.owed) : "");
    setPaidOn(todayISO());
    setReference("");
    setNotes("");
    setErrors([]);
    // Reset only when the dialog opens, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amt = Number(amount);
  const amountBad = single && (!Number.isFinite(amt) || amt <= 0 || amt > targets[0]!.owed + 0.001);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountBad) return;
    setErrors([]);
    start(async () => {
      const res = await recordPayments({
        items: targets.map(({ kind, id, label }) => ({ kind, id, label, amount: single ? amt : undefined })),
        paid_on: paidOn,
        method,
        reference,
        notes,
      });
      if (res.recorded > 0) router.refresh();
      if (res.ok) {
        onDone?.(`Recorded ${res.recorded} payment${res.recorded === 1 ? "" : "s"} · ${money(res.total)}`);
        onClose();
      } else {
        setErrors(res.errors);
        if (res.recorded > 0) onDone?.(`Recorded ${res.recorded}; ${res.errors.length} need attention`);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={single ? "Record payment" : `Collect ${targets.length} items in full`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="payment-form" className="btn-primary" disabled={pending || amountBad}>
            {pending && <Loader size="xs" tone="current" />}
            {pending ? "Saving…" : single ? `Record ${Number.isFinite(amt) && amt > 0 ? money(amt) : "payment"}` : `Collect ${money(owedTotal)}`}
          </button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-4">
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line-subtle bg-sunken p-3 text-[12.5px]">
          {targets.map((t) => (
            <div key={`${t.kind}:${t.id}`} className="flex items-center justify-between gap-3">
              <span className="truncate text-fg">{t.label}</span>
              <span className="shrink-0 tabular-nums text-muted-fg">{money(t.owed)} owed</span>
            </div>
          ))}
        </div>

        {single && (
          <div>
            <label className="label" htmlFor="pay-amount">Amount received (KES)</label>
            <input
              id="pay-amount"
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={targets[0]!.owed}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <span className="mt-1 block text-[11.5px] text-muted-fg">
              Less than {money(targets[0]!.owed)} records a part-payment; the rest stays owed.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pay-date">Received on</label>
            <input id="pay-date" className="input" type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="pay-method">Method</label>
            <select id="pay-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pay-ref">Reference <span className="font-normal text-muted-fg">(M-Pesa code, cheque no.)</span></label>
          <input id="pay-ref" className="input font-mono" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="e.g. SJK4H7Q2LP" maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="pay-notes">Notes <span className="font-normal text-muted-fg">(optional)</span></label>
          <input id="pay-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </div>

        {errors.length > 0 && (
          <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {errors.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}
      </form>
    </Dialog>
  );
}
