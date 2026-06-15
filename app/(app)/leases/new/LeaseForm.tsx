"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";

type Property = {
  id: string;
  name: string;
  area_sqft: number;
  service_charge_monthly: number;
  compounds: { name: string } | { name: string }[] | null;
};

function compoundName(c: Property["compounds"]): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

export function LeaseForm({
  properties,
  preselect,
  action,
}: {
  properties: Property[];
  preselect?: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [propertyId, setPropertyId] = useState(preselect || properties[0]?.id || "");
  const [gross, setGross] = useState<number>(0);
  const [scMode, setScMode] = useState<"we_pay" | "lessee_direct">("we_pay");

  const selected = useMemo(() => properties.find((p) => p.id === propertyId), [propertyId, properties]);
  const sc = Number(selected?.service_charge_monthly || 0);
  const deduction = scMode === "lessee_direct" ? 0 : sc;
  const net = gross - deduction;

  if (!properties.length) {
    return (
      <div className="card">
        <p className="text-sm">No vacant properties available. Every property is currently rented or archived.</p>
        <Link href="/properties" className="btn-secondary mt-3 inline-flex">Back to properties</Link>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-4">
      <div>
        <label className="label">Property</label>
        <select
          name="property_id"
          required
          className="input"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {compoundName(p.compounds)} — {p.name} ({Number(p.area_sqft).toLocaleString()} sqft)
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Lessee name</label>
          <input name="lessee_name" required className="input" />
        </div>
        <div>
          <label className="label">Contact (email or phone)</label>
          <input name="lessee_contact" className="input" placeholder="Optional" />
        </div>
        <div>
          <label className="label">Lease start date</label>
          <input name="start_date" type="date" required className="input" />
        </div>
        <div>
          <label className="label">Lease end date</label>
          <input name="end_date" type="date" required className="input" />
        </div>
        <div>
          <label className="label">Gross rent / month (KES, incl. tax)</label>
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
            defaultValue={0}
            placeholder="e.g. 2 months rent"
          />
          <p className="text-xs text-muted-fg mt-1">Tracked separately from monthly rent; refundable at lease end.</p>
        </div>
        <div>
          <label className="label">Lessee document (Google Drive URL)</label>
          <input
            name="lessee_doc_url"
            type="url"
            className="input"
            placeholder="https://drive.google.com/..."
          />
          <p className="text-xs text-muted-fg mt-1">Optional — paste a link to the signed lease document.</p>
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
              { v: "we_pay",        title: "We pay the service charge",                  sub: `Net rent we receive: ${money(net)} (gross ${money(gross)} − SC ${money(sc)}). SC appears in the Service Charges tab as 'pending' for those months — mark paid when paid.` },
              { v: "lessee_direct", title: "Lessee pays the service charge directly",     sub: `Lessee pays SC straight to the provider. Net rent we receive: ${money(gross)} (no deduction). SC rows for those months are tagged 'lessee direct' (off our pending list).` },
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

      {selected && sc > 0 && (
        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Service charge / mo</span><span>{money(sc)}</span></div>
          <div className="flex justify-between"><span>Gross rent / mo</span><span>{money(gross)}</span></div>
          <div className="flex justify-between font-medium border-t border-border pt-1">
            <span>Net rent we receive</span>
            <span>{money(net)}</span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <SubmitButton loadingText="Creating…">Create lease</SubmitButton>
        <Link href="/leases" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
