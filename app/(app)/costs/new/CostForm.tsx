"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money, todayISO } from "@/lib/format";

type Property = { id: string; name: string; area_sqft: number; compounds: { name: string } | { name: string }[] | null };

function compoundName(c: Property["compounds"]): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

const CATEGORIES = ["general", "maintenance", "utilities", "tax", "service_charge", "insurance", "other"];

export function CostForm({ properties, action }: { properties: Property[]; action: (fd: FormData) => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState<number>(0);

  const totalSqft = useMemo(
    () => properties.filter((p) => picked.includes(p.id)).reduce((s, p) => s + Number(p.area_sqft), 0),
    [picked, properties]
  );

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <form action={action} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Description</label>
          <input name="description" required className="input" placeholder="e.g. Plumbing repair" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" required className="input" defaultValue="general">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Amount (KES)</label>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input name="incurred_on" type="date" required className="input" defaultValue={todayISO()} />
        </div>
      </div>

      <div>
        <label className="label">Apply to property/properties</label>
        <p className="text-xs text-muted-fg mb-2">
          Pick one for a single-property cost. Pick multiple to auto-split the amount by sqft.
        </p>
        <div className="border border-border rounded-md max-h-72 overflow-auto divide-y">
          {properties.map((p) => {
            const checked = picked.includes(p.id);
            const share = checked && totalSqft > 0 ? (Number(p.area_sqft) / totalSqft) * amount : 0;
            return (
              <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  name="property_ids"
                  value={p.id}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                />
                <span className="flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-fg"> · {compoundName(p.compounds)} · {Number(p.area_sqft).toLocaleString()} sqft</span>
                </span>
                {checked && picked.length > 1 && <span className="text-xs text-muted-fg">≈ {money(share)}</span>}
              </label>
            );
          })}
          {!properties.length && <div className="p-4 text-sm text-muted-fg">No properties available.</div>}
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea name="notes" className="input" rows={2} />
      </div>

      <div className="flex gap-2">
        <button className="btn-primary">Save cost</button>
        <Link href="/costs" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
