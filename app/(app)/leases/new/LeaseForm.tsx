"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { DriveUpload } from "@/components/DriveUpload";

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
  const [lesseePaysSC, setLesseePaysSC] = useState(false);

  const selected = useMemo(() => properties.find((p) => p.id === propertyId), [propertyId, properties]);
  const sc = Number(selected?.service_charge_monthly || 0);
  const net = lesseePaysSC ? gross - sc : gross;

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
        <div className="col-span-2">
          <DriveUpload name="lessee_doc_url" kind="lease-doc" label="Lessee document" />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="lessee_pays_service_charge"
          checked={lesseePaysSC}
          onChange={(e) => setLesseePaysSC(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Lessee pays the service charge</span>
          <span className="block text-muted-fg text-xs">
            Service charge is still posted as a company cost; net rent we receive each month is reduced by {money(sc)}.
          </span>
        </span>
      </label>

      {selected && (
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
        <button className="btn-primary">Create lease</button>
        <Link href="/leases" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
