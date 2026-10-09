"use client";
import { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRESETS } from "@/lib/analytics/compute";

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export type Option = { value: string; label: string; sub?: string };

/** Button + searchable checklist. Shows "Compound · 2" when something is picked. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  align = "left",
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState("");
  const list = q.trim() ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(q.trim().toLowerCase())) : options;
  const set = new Set(value);
  const toggle = (v: string) => onChange(set.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn("btn-secondary h-8 gap-1.5 px-2.5", value.length && "border-primary/40 bg-primary-soft text-primary")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        {value.length > 0 && <span className="rounded bg-primary px-1 text-[10.5px] font-semibold leading-4 text-white">{value.length}</span>}
        <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className={cn("popover absolute z-40 mt-1 w-72 max-w-[calc(100vw-32px)] animate-fade-in", align === "right" ? "right-0" : "left-0")}>
          <div className="border-b border-line-subtle px-2 pb-1.5 pt-0.5">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-fg" />
              <input className="input h-8 !pl-7" placeholder={`Find ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto py-1">
            {list.map((o) => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={set.has(o.value)} onClick={() => toggle(o.value)} className="popover-item justify-between gap-2">
                  <span className="min-w-0">
                    <span className={cn("block truncate", set.has(o.value) && "font-medium")}>{o.label}</span>
                    {o.sub && <span className="block truncate text-[11px] text-muted-fg">{o.sub}</span>}
                  </span>
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", set.has(o.value) ? "border-primary bg-primary text-white" : "border-line-strong")}>
                    {set.has(o.value) && <Check size={11} strokeWidth={3} />}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-3 text-[12px] text-muted-fg">No matches.</li>}
          </ul>
          {value.length > 0 && (
            <div className="flex justify-between border-t border-line-subtle px-2 pt-1.5">
              <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([])}>Clear</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Preset periods plus a custom from/to, and the "compare to previous period" switch. */
export function PeriodPicker({
  preset,
  from,
  to,
  compare,
  onChange,
  onCompare,
  label,
}: {
  preset: string;
  from: string;
  to: string;
  compare: boolean;
  onChange: (p: { preset: string; from?: string; to?: string }) => void;
  onCompare: (v: boolean) => void;
  label: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);
  useEffect(() => { if (open) { setCf(from); setCt(to); } }, [open, from, to]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary h-8 gap-2 px-2.5" aria-haspopup="dialog" aria-expanded={open}>
        <Calendar size={14} className="text-muted-fg" />
        <span>{label}</span>
        <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="popover absolute left-0 z-40 mt-1 w-72 max-w-[calc(100vw-32px)] animate-fade-in">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => { onChange({ preset: p.key }); setOpen(false); }} className="popover-item justify-between">
              <span className={cn(preset === p.key && "font-medium")}>{p.label}</span>
              {preset === p.key && <Check size={14} className="text-primary" />}
            </button>
          ))}
          <div className="mt-1 space-y-2 border-t border-line-subtle px-3 pb-1 pt-2.5">
            <div className="text-[11.5px] font-medium text-fg-soft">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input h-8 !px-2 !py-1" value={cf} onChange={(e) => setCf(e.target.value)} aria-label="From" />
              <input type="date" className="input h-8 !px-2 !py-1" value={ct} min={cf} onChange={(e) => setCt(e.target.value)} aria-label="To" />
            </div>
            <button type="button" className="btn-primary btn-sm w-full" disabled={!cf || !ct || cf > ct} onClick={() => { onChange({ preset: "custom", from: cf, to: ct }); setOpen(false); }}>
              Apply range
            </button>
          </div>
          <label className="mt-1 flex cursor-pointer items-center justify-between border-t border-line-subtle px-3 py-2.5 text-[12.5px]">
            <span>Compare with previous period</span>
            <input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
          </label>
        </div>
      )}
    </div>
  );
}
