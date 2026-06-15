"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Calendar } from "lucide-react";
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

  return (
    <>
      <div ref={wrapRef} className="relative inline-block mb-5">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="btn-secondary text-sm min-w-[180px] justify-between"
        >
          <span className="flex items-center gap-2">
            <Calendar size={14} className="text-muted-fg" />
            {period.label}
          </span>
          <ChevronDown size={14} className={cn("transition-transform", menuOpen && "rotate-180")} />
        </button>
        {menuOpen && (
          <div className="absolute z-30 left-0 mt-1 w-56 border border-border bg-surface rounded shadow-sm">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.range}
                type="button"
                onClick={() => selectPreset(p.range)}
                className={cn(
                  "block w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                  active === p.range && "bg-primary-soft text-primary font-medium"
                )}
              >
                {p.label}
              </button>
            ))}
            <div className="border-t border-border" />
            <button
              type="button"
              onClick={() => selectPreset("custom")}
              className={cn(
                "block w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                active === "custom" && "bg-primary-soft text-primary font-medium"
              )}
            >
              Custom range…
            </button>
          </div>
        )}
      </div>

      {customOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={() => setCustomOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={applyCustom}
            className="card w-full max-w-sm space-y-4"
          >
            <h2 className="font-semibold">Custom date range</h2>
            <div>
              <label className="label">From</label>
              <input
                type="date"
                required
                className="input"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                type="date"
                required
                className="input"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom || undefined}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCustomOpen(false)} className="btn-ghost text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Apply</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
