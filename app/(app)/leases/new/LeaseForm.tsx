"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { Combobox } from "@/components/Combobox";

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
  existingLessees,
  action,
}: {
  properties: Property[];
  preselect?: string;
  existingLessees: string[];
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
        <PropertyPicker
          properties={properties}
          value={propertyId}
          onChange={setPropertyId}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Lessee name</label>
          <Combobox
            name="lessee_name"
            options={existingLessees}
            required
            placeholder="Type a name or pick an existing lessee"
            emptyHint="No prior lessees — type a new name."
          />
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
          <label className="label">Deposit charged (KES)</label>
          <input
            name="deposit_charged"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={0}
            placeholder="e.g. 2 months rent"
          />
        </div>
        <div>
          <label className="label">Deposit collected (KES)</label>
          <input
            name="deposit_collected"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={0}
          />
        </div>
        <div>
          <label className="label">Lessee document (Google Drive URL)</label>
          <input
            name="lessee_doc_url"
            type="url"
            className="input"
            placeholder="https://drive.google.com/..."
          />
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
              { v: "we_pay",        title: "We pay the service charge",                  sub: "" },
              { v: "lessee_direct", title: "Lessee pays the service charge directly",     sub: "" },
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
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {selected && sc > 0 && (
        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Rent / mo</span><span>{money(gross)}</span></div>
          <div className="flex justify-between"><span>Service charge / mo</span><span>{money(sc)}</span></div>
        </div>
      )}

      <div className="flex gap-2">
        <SubmitButton loadingText="Creating…">Create lease</SubmitButton>
        <Link href="/leases" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

/**
 * Compound-grouped property picker — uses our Combobox styling for
 * consistency instead of the browser-default <select>. Displays the
 * property label and syncs a hidden input under `property_id` for the
 * server action.
 */
function PropertyPicker({
  properties,
  value,
  onChange,
}: {
  properties: Property[];
  value: string;
  onChange: (id: string) => void;
}) {
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, `${compoundName(p.compounds)} — ${p.name}`);
    return m;
  }, [properties]);
  const labels = useMemo(() => Array.from(labelById.values()).sort((a, b) => a.localeCompare(b)), [labelById]);
  const idByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, label] of labelById) m.set(label, id);
    return m;
  }, [labelById]);

  return (
    <>
      <input type="hidden" name="property_id" value={value} />
      <Combobox
        name="__property_label"
        options={labels}
        initial={labelById.get(value) ?? ""}
        placeholder="Pick a property"
        required
        emptyHint="No vacant properties available."
      />
      {/* Sync label → id when the underlying combobox changes.
          The Combobox writes to name="__property_label"; we mirror to property_id via a controlled bridge. */}
      <SyncPropertyId labelById={idByLabel} onChange={onChange} />
    </>
  );
}

function SyncPropertyId({
  labelById,
  onChange,
}: {
  labelById: Map<string, string>;
  onChange: (id: string) => void;
}) {
  // Watch the hidden __property_label input; when it changes, resolve to id.
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const form = el.closest("form");
    if (!form) return;
    const input = form.querySelector('input[name="__property_label"]') as HTMLInputElement | null;
    if (!input) return;
    // MutationObserver on value attribute (hidden inputs use value prop, so observe it via periodic check).
    let lastLabel = "";
    const tick = () => {
      const cur = input.value;
      if (cur !== lastLabel) {
        lastLabel = cur;
        const id = labelById.get(cur);
        if (id) onChange(id);
      }
    };
    const interval = window.setInterval(tick, 120);
    return () => window.clearInterval(interval);
  }, [labelById, onChange]);
  return <span ref={ref} className="hidden" aria-hidden />;
}
