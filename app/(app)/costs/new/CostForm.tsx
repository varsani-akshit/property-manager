"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { money, todayISO } from "@/lib/format";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { Combobox } from "@/components/Combobox";

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

function CategoryCell({
  value,
  onChange,
  options,
  index,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  index: number;
}) {
  // The Combobox renders its own hidden input under this name, picked up by the server action.
  return (
    <div onBlur={(e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v !== value && v) onChange(v.toLowerCase());
    }}>
      <Combobox
        name={`line_category_${index}`}
        options={options}
        initial={value}
        placeholder="Category"
        required
      />
    </div>
  );
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
        <p className="text-xs text-muted-fg mb-2">Add one line per cost category. e.g. Plumbing 15,000 + Electrical 8,000. Click the dropdown to see existing categories.</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-start">
              <CategoryCell
                value={l.category}
                onChange={(v) => setLineField(l.id, "category", v)}
                options={categories}
                index={i}
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
                className="btn-secondary px-2 disabled:opacity-30 h-10"
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

      {/* PROPERTY / COMPOUND ALLOCATION */}
      <CompoundPicker
        properties={filtered}
        allProperties={properties}
        picked={picked}
        setPicked={setPicked}
        totalAmount={totalAmount}
        totalSqft={totalSqft}
        search={search}
        setSearch={setSearch}
      />

      <div className="flex gap-2">
        <button className="btn-primary">{initial ? "Save changes" : "Save cost"}</button>
        <Link href="/costs" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

/**
 * Properties grouped under their compound. Compound header has a tri-state checkbox
 * (none / some / all) that selects or deselects every property in that compound.
 * The hidden `property_ids` checkboxes still drive the form payload — the compound
 * checkbox is purely a UI convenience.
 */
function CompoundPicker({
  properties,
  allProperties,
  picked,
  setPicked,
  totalAmount,
  totalSqft,
  search,
  setSearch,
}: {
  properties: Property[];
  allProperties: Property[];
  picked: string[];
  setPicked: React.Dispatch<React.SetStateAction<string[]>>;
  totalAmount: number;
  totalSqft: number;
  search: string;
  setSearch: (v: string) => void;
}) {
  // Group filtered properties by compound name.
  const groups = useMemo(() => {
    const m = new Map<string, Property[]>();
    for (const p of properties) {
      const k = compoundName(p.compounds) || "—";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [properties]);

  // Collapsed/expanded state per compound name (default: collapsed if many; expanded if few).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const [name, props] of groups) {
      init[name] = props.length > 6; // collapse big groups by default
    }
    return init;
  });

  function toggleProperty(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function setGroupSelection(groupName: string, props: Property[], shouldCheck: boolean) {
    const ids = props.map((p) => p.id);
    setPicked((cur) => {
      const others = cur.filter((x) => !ids.includes(x));
      return shouldCheck ? Array.from(new Set([...others, ...ids])) : others;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label !mb-0">Apply to compound / properties</label>
        <span className="text-xs text-muted-fg">{picked.length} selected</span>
      </div>
      <p className="text-xs text-muted-fg mb-2">
        Pick a whole compound (all its properties get selected) or individual properties.
        Multi-selection auto-splits the total ({money(totalAmount)}) by sqft.
      </p>
      <input
        type="search"
        className="input mb-2 text-sm"
        placeholder="Search by property, compound, or lessee…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="border border-border rounded-md max-h-96 overflow-auto divide-y">
        {groups.map(([compoundLabel, props]) => {
          const groupIds = props.map((p) => p.id);
          const inSet = picked.filter((x) => groupIds.includes(x));
          const allChecked = inSet.length === groupIds.length && groupIds.length > 0;
          const someChecked = inSet.length > 0 && !allChecked;
          const isCollapsed = collapsed[compoundLabel];
          const groupSqft = props.reduce((s, p) => s + Number(p.area_sqft), 0);

          return (
            <div key={compoundLabel}>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 sticky top-0 z-10">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [compoundLabel]: !c[compoundLabel] }))}
                  className="p-0.5 rounded hover:bg-muted shrink-0"
                  aria-label={isCollapsed ? "Expand" : "Collapse"}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <CompoundCheckbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={(v) => setGroupSelection(compoundLabel, props, v)}
                />
                <div className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold">{compoundLabel}</span>
                  <span className="text-muted-fg"> · {props.length} {props.length === 1 ? "property" : "properties"} · {groupSqft.toLocaleString()} sqft</span>
                </div>
                <span className="text-xs text-muted-fg whitespace-nowrap">
                  {inSet.length}/{groupIds.length}
                </span>
              </div>
              {!isCollapsed && props.map((p) => {
                const checked = picked.includes(p.id);
                const share = checked && totalSqft > 0 ? (Number(p.area_sqft) / totalSqft) * totalAmount : 0;
                return (
                  <label key={p.id} className="flex items-center gap-3 pl-9 pr-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                    {/* Pure UI checkbox; the source of truth is the hidden inputs rendered below. */}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProperty(p.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-fg"> · {Number(p.area_sqft).toLocaleString()} sqft</span>
                      {p.active_lessee && <span className="text-xs text-muted-fg block truncate">Lessee: {p.active_lessee}</span>}
                    </span>
                    {checked && picked.length > 1 && <span className="text-xs text-muted-fg whitespace-nowrap">≈ {money(share)}</span>}
                  </label>
                );
              })}
            </div>
          );
        })}
        {!groups.length && <div className="p-4 text-sm text-muted-fg">No matching properties.</div>}
      </div>

      {/* Source of truth for form submission — covers picks across all groups,
          regardless of filter or collapsed state. */}
      {picked.map((id) => (
        <input key={id} type="hidden" name="property_ids" value={id} />
      ))}
    </div>
  );
}

function CompoundCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="shrink-0"
    />
  );
}
