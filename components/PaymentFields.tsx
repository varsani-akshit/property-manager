import { PAYMENT_METHODS } from "@/lib/payment-methods";

/**
 * Date / method / reference inputs for forms that change a collected total.
 * Read them server-side with paymentFieldsFrom() (lib/payments-server).
 */
export function PaymentFields({ hint = "Used for the payment log entry if the collected total changes." }: { hint?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <fieldset className="space-y-3 rounded-lg border border-line-subtle p-3">
      <legend className="px-1 text-[12px] font-medium text-fg-soft">Payment details</legend>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="paid_on">Received on</label>
          <input id="paid_on" name="paid_on" type="date" className="input" defaultValue={today} max={today} />
        </div>
        <div>
          <label className="label" htmlFor="method">Method</label>
          <select id="method" name="method" className="input" defaultValue="mpesa">
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="reference">Reference</label>
        <input id="reference" name="reference" className="input font-mono uppercase" placeholder="M-Pesa code, cheque no." maxLength={60} />
      </div>
      <p className="text-[11.5px] text-muted-fg">{hint}</p>
    </fieldset>
  );
}
