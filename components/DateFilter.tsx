"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Calendar, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { PERIOD_PRESETS, resolvePeriod, type Range } from "@/lib/period";

export function DateFilter({ active }: { active: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = resolvePeriod({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(period.range === "custom" ? period.from : "");
  const [customTo, setCustomTo] = useState(period.range === "custom" ? period.to : "");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function selectPreset(range: Range) {
    setMenuOpen(false);
    if (range === "custom") {
      setCustomOpen(true);
      return;
    }
    const params = new URLSearchParams(sp.toString());
    params.set("range", range);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    const params = new URLSearchParams(sp.toString());
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo);
    router.push(`${pathname}?${params.toString()}`);
    setCustomOpen(false);
  }

  const item = (range: Range, label: string) => (
    <button
      key={range}
      type="button"
      role="option"
      aria-selected={active === range}
      onClick={() => selectPreset(range)}
      className="popover-item justify-between"
    >
      <span className={cn(active === range && "font-medium")}>{label}</span>
      {active === range && <Check size={14} className="text-primary" />}
    </button>
  );

  return (
    <>
      <div ref={wrapRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="btn-secondary h-8 gap-2 px-2.5"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
        >
          <Calendar size={14} className="text-muted-fg" />
          <span>{period.label}</span>
          <ChevronDown size={14} className={cn("text-muted-fg transition-transform", menuOpen && "rotate-180")} />
        </button>
        {menuOpen && (
          <div role="listbox" className="popover absolute right-0 mt-1 w-56 animate-fade-in">
            {PERIOD_PRESETS.map((p) => item(p.range, p.label))}
            <div className="my-1 border-t border-line-subtle" />
            {item("custom", "Custom range…")}
          </div>
        )}
      </div>

      {customOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default"
            style={{ background: "var(--overlay)" }}
            onClick={() => setCustomOpen(false)}
          />
          <form
            onSubmit={applyCustom}
            className="relative w-full max-w-sm animate-fade-in rounded-lg border border-border bg-raised shadow-token-lg"
          >
            <div className="border-b border-line-subtle px-4 py-3">
              <h2 className="text-[15px] font-semibold text-fg">Custom date range</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-4">
              <div>
                <label className="label" htmlFor="df-from">From</label>
                <input
                  id="df-from"
                  type="date"
                  required
                  className="input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="df-to">To</label>
                <input
                  id="df-to"
                  type="date"
                  required
                  className="input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom || undefined}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">
              <button type="button" onClick={() => setCustomOpen(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Apply</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
