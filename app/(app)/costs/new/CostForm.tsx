"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { money, todayISO } from "@/lib/format";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { Combobox } from "@/components/Combobox";
import { SubmitButton } from "@/components/SubmitButton";
import { cn } from "@/lib/cn";

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
    payable_by_lessee?: boolean;
    lease_id?: string | null;
    due_date?: string | null;
  };
}) {
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.length
      ? initial.lines.map((l) => ({ id: crypto.randomUUID(), category: l.category, amount: String(l.amount) }))
      : [newLine()]
  );
  const [picked, setPicked] = useState<string[]>(initial?.propertyIds ?? []);
  const [search, setSearch] = useState("");
  const [billToLessee, setBillToLessee] = useState<boolean>(initial?.payable_by_lessee ?? false);
  const [dueDate, setDueDate] = useState<string>(initial?.due_date ?? "");

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [lines]
  );

  const totalSqft = useMemo(
    () => properties.filter((p) => picked.includes(p.id)).reduce((s, p) => s + Number(p.area_sqft), 0),
    [picked, properties]
  );

  // When billing to a lessee, restrict the pool to actively-leased properties only.
  const propertyPool = useMemo(
    () => (billToLessee ? properties.filter((p) => !!p.active_lessee) : properties),
    [properties, billToLessee]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return propertyPool;
    const needle = search.toLowerCase().trim();
    return propertyPool.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      compoundName(p.compounds).toLowerCase().includes(needle) ||
      (p.active_lessee?.toLowerCase().includes(needle) ?? false)
    );
  }, [propertyPool, search]);

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

      {/* BILL TO LESSEE TOGGLE */}
      <div className="border border-border rounded-md p-3 bg-muted/30">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="payable_by_lessee"
            value="1"
            checked={billToLessee}
            onChange={(e) => {
              const next = e.target.checked;
              setBillToLessee(next);
              if (next) setPicked((cur) => cur.slice(0, 1)); // collapse multi-pick to first
            }}
          />
          <span className="text-sm font-medium">Bill this cost to a lessee</span>
        </label>

        {billToLessee && (
          <div className="mt-3 pl-6">
            <label className="label">Due date</label>
            <input
              name="due_date"
              type="date"
              required={billToLessee}
              className="input max-w-xs"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* PROPERTY PICKER — filtered to leased properties when billing a lessee, single-select */}
      <CompoundPicker
        properties={filtered}
        allProperties={propertyPool}
        picked={picked}
        setPicked={setPicked}
        totalAmount={totalAmount}
        totalSqft={totalSqft}
        search={search}
        setSearch={setSearch}
        singleSelect={billToLessee}
        title={billToLessee ? "Pick the leased property" : "Apply to compound / properties"}
      />

      <div className="flex gap-2">
        <SubmitButton loadingText="Saving…">{initial ? "Save changes" : "Save cost"}</SubmitButton>
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
  singleSelect = false,
  title = "Apply to compound / properties",
}: {
  properties: Property[];
  allProperties: Property[];
  picked: string[];
  setPicked: React.Dispatch<React.SetStateAction<string[]>>;
  totalAmount: number;
  totalSqft: number;
  search: string;
  setSearch: (v: string) => void;
  singleSelect?: boolean;
  title?: string;
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
    setPicked((cur) => {
      if (singleSelect) return cur.includes(id) ? [] : [id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  }

  function setGroupSelection(groupName: string, props: Property[], shouldCheck: boolean) {
    if (singleSelect) return; // group-select doesn't apply in single-select mode
    const ids = props.map((p) => p.id);
    setPicked((cur) => {
      const others = cur.filter((x) => !ids.includes(x));
      return shouldCheck ? Array.from(new Set([...others, ...ids])) : others;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label !mb-0">{title}</label>
        <span className="text-xs text-muted-fg">{picked.length} selected</span>
      </div>
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
                {!singleSelect && (
                  <CompoundCheckbox
                    checked={allChecked}
                    indeterminate={someChecked}
                    onChange={(v) => setGroupSelection(compoundLabel, props, v)}
                  />
                )}
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
                const share = checked && !singleSelect && totalSqft > 0 ? (Number(p.area_sqft) / totalSqft) * totalAmount : 0;
                return (
                  <label key={p.id} className="flex items-center gap-3 pl-9 pr-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                    <input
                      type={singleSelect ? "radio" : "checkbox"}
                      name={singleSelect ? "property_pick_radio" : undefined}
                      checked={checked}
                      onChange={() => toggleProperty(p.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-fg"> · {Number(p.area_sqft).toLocaleString()} sqft</span>
                      {p.active_lessee && (
                        <span className={cn("text-xs block truncate", singleSelect ? "text-primary font-medium" : "text-muted-fg")}>
                          Lessee: {p.active_lessee}
                        </span>
                      )}
                    </span>
                    {checked && !singleSelect && picked.length > 1 && (
                      <span className="text-xs text-muted-fg whitespace-nowrap">≈ {money(share)}</span>
                    )}
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
