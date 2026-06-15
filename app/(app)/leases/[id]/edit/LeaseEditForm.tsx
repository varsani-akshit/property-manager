"use client";
import { useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";

export function LeaseEditForm({ lease, action }: { lease: any; action: (fd: FormData) => Promise<void> }) {
  const sc = Number(lease.properties?.service_charge_monthly || 0);
  const [gross, setGross] = useState<number>(Number(lease.gross_rent_monthly));
  const initialMode: "we_pay" | "lessee_direct" =
    lease.sc_payment_mode === "lessee_direct" ? "lessee_direct" : "we_pay";
  const [scMode, setScMode] = useState<"we_pay" | "lessee_direct">(initialMode);
  const deduction = scMode === "lessee_direct" ? 0 : sc;
  const net = gross - deduction;

  return (
    <form action={action} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Lessee name</label>
          <input name="lessee_name" required className="input" defaultValue={lease.lessee_name} />
        </div>
        <div>
          <label className="label">Contact</label>
          <input name="lessee_contact" className="input" defaultValue={lease.lessee_contact ?? ""} placeholder="Optional" />
        </div>
        <div>
          <label className="label">Start date</label>
          <input name="start_date" type="date" required className="input" defaultValue={lease.start_date} />
        </div>
        <div>
          <label className="label">End date</label>
          <input name="end_date" type="date" required className="input" defaultValue={lease.end_date} />
        </div>
        <div>
          <label className="label">Gross rent / month (KES)</label>
          <input
            name="gross_rent_monthly"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            value={gross || ""}
            onChange={(e) => setGross(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Deposit collected (KES)</label>
          <input
            name="deposit_amount"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={Number(lease.deposit_amount ?? 0)}
          />
        </div>
        <div>
          <label className="label">Lessee document URL</label>
          <input
            name="lessee_doc_url"
            type="url"
            className="input"
            defaultValue={lease.lessee_doc_url ?? ""}
            placeholder="https://drive.google.com/..."
          />
          <p className="text-xs text-muted-fg mt-1">Optional — link to the signed lease in Drive.</p>
        </div>
      </div>

      <div>
        <label className="label">Service charge handling</label>
        {sc <= 0 ? (
          <p className="text-xs text-muted-fg">
            This property has no service charge configured, so this setting doesn&apos;t apply.
          </p>
        ) : (
          <div className="space-y-2">
            {[
              { v: "we_pay",        title: "We pay the service charge",                sub: `Net rent we receive: ${money(net)} (gross ${money(gross)} − SC ${money(sc)}). SC appears in Service Charges as 'pending' — mark paid each month.` },
              { v: "lessee_direct", title: "Lessee pays the service charge directly",  sub: `Net rent we receive: ${money(gross)}. SC rows for these lease months tagged 'lessee direct'.` },
            ].map((opt) => (
              <label
                key={opt.v}
                className={`block rounded-md border p-3 cursor-pointer text-sm ${scMode === opt.v ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50"}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="sc_payment_mode"
                    value={opt.v}
                    checked={scMode === opt.v}
                    onChange={() => setScMode(opt.v as typeof scMode)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">{opt.title}</div>
                    <div className="text-xs text-muted-fg">{opt.sub}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {sc > 0 && (
        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Service charge / mo</span><span>{money(sc)}</span></div>
          <div className="flex justify-between"><span>Gross rent / mo</span><span>{money(gross)}</span></div>
          <div className="flex justify-between font-medium border-t border-border pt-1">
            <span>Net rent we receive</span>
            <span>{money(net)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-fg">
        Changes apply going forward. Rent already marked &quot;collected&quot; or overdue for past months keeps its original amount.
      </p>

      <div className="flex gap-2">
        <SubmitButton>Save changes</SubmitButton>
        <Link href={`/properties/${lease.property_id}`} className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
