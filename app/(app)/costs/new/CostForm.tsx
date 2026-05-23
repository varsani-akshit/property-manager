"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money, todayISO } from "@/lib/format";
import { Plus, X } from "lucide-react";

type Property = {
  id: string;
  name: string;
  area_sqft: number;
  compounds: { name: string } | { name: string }[] | null;
  active_lessee?: string | null;
};

function compoundName(c: Property["compounds"]): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

type Line = { id: string; category: string; amount: string };

const newLine = (): Line => ({ id: crypto.randomUUID(), category: "", amount: "" });

export function CostForm({
  properties,
  categories,
  action,
  initial,
}: {
  properties: Property[];
  categories: string[];
  action: (fd: FormData) => Promise<void>;
  initial?: {
    description: string;
    incurred_on: string;
    notes: string;
    lines: { category: string; amount: number }[];
    propertyIds: string[];
  };
}) {
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.length
      ? initial.lines.map((l) => ({ id: crypto.randomUUID(), category: l.category, amount: String(l.amount) }))
      : [newLine()]
  );
  const [picked, setPicked] = useState<string[]>(initial?.propertyIds ?? []);
  const [search, setSearch] = useState("");

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [lines]
  );

  const totalSqft = useMemo(
    () => properties.filter((p) => picked.includes(p.id)).reduce((s, p) => s + Number(p.area_sqft), 0),
    [picked, properties]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return properties;
    const needle = search.toLowerCase().trim();
    return properties.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      compoundName(p.compounds).toLowerCase().includes(needle) ||
      (p.active_lessee?.toLowerCase().includes(needle) ?? false)
    );
  }, [properties, search]);

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function setLineField(id: string, field: "category" | "amount", value: string) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((cur) => [...cur, newLine()]);
  }

  function removeLine(id: string) {
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((l) => l.id !== id)));
  }

  return (
    <form action={action} className="card space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <input
            name="description"
            required
            className="input"
            placeholder="e.g. April building maintenance"
            defaultValue={initial?.description}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input name="incurred_on" type="date" required className="input" defaultValue={initial?.incurred_on ?? todayISO()} />
        </div>
        <div>
          <label className="label">Notes</label>
          <input name="notes" className="input" defaultValue={initial?.notes ?? ""} placeholder="Optional" />
        </div>
      </div>

      {/* LINE ITEMS */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label !mb-0">Line items</label>
          <span className="text-xs text-muted-fg">Total: <span className="font-medium text-fg">{money(totalAmount)}</span></span>
        </div>
        <p className="text-xs text-muted-fg mb-2">Add one line per cost category. e.g. Plumbing 15,000 + Electrical 8,000.</p>
        <datalist id="cost-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-center">
              <input
                list="cost-categories"
                name={`line_category_${i}`}
                required
                className="input"
                placeholder="Category (e.g. maintenance)"
                value={l.category}
                onChange={(e) => setLineField(l.id, "category", e.target.value.toLowerCase())}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                name={`line_amount_${i}`}
                required
                className="input"
                placeholder="Amount"
                value={l.amount}
                onChange={(e) => setLineField(l.id, "amount", e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeLine(l.id)}
                disabled={lines.length === 1}
                className="btn-secondary px-2 disabled:opacity-30"
                aria-label="Remove line"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addLine} className="btn-secondary text-xs mt-2">
          <Plus size={12} /> Add another line
        </button>
        <input type="hidden" name="line_count" value={lines.length} />
      </div>

      {/* PROPERTY ALLOCATION */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="label !mb-0">Apply to property/properties</label>
          <span className="text-xs text-muted-fg">{picked.length} selected · {filtered.length} shown</span>
        </div>
        <p className="text-xs text-muted-fg mb-2">
          Pick one for a single-property cost. Pick multiple to auto-split the total ({money(totalAmount)}) by sqft.
        </p>
        <input
          type="search"
          className="input mb-2 text-sm"
          placeholder="Search by property, compound, or lessee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="border border-border rounded-md max-h-72 overflow-auto divide-y">
          {filtered.map((p) => {
            const checked = picked.includes(p.id);
            const share = checked && totalSqft > 0 ? (Number(p.area_sqft) / totalSqft) * totalAmount : 0;
            return (
              <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  name="property_ids"
                  value={p.id}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                />
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-fg"> · {compoundName(p.compounds)} · {Number(p.area_sqft).toLocaleString()} sqft</span>
                  {p.active_lessee && <span className="text-xs text-muted-fg block truncate">Lessee: {p.active_lessee}</span>}
                </span>
                {checked && picked.length > 1 && <span className="text-xs text-muted-fg whitespace-nowrap">≈ {money(share)}</span>}
              </label>
            );
          })}
          {!filtered.length && <div className="p-4 text-sm text-muted-fg">No matching properties.</div>}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary">{initial ? "Save changes" : "Save cost"}</button>
        <Link href="/costs" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
