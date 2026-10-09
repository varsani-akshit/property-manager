"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string, withYear = true) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(2, 4)}` : ""}`;

export function compactNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}
function niceMax(max: number) {
  if (max <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= max) return m * e;
  return 10 * e;
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-[2px]", className)} style={{ background: color }} />;
}

// ─── Trend: billed vs received (bars) + collection rate (line) ──────────────

export type TrendSeries = { key: string; label: string; color: string; values: number[] };

export function TrendChart({
  months,
  bars,
  line,
  onMonth,
  activeMonth,
  format,
  height = 220,
}: {
  months: string[];
  bars: TrendSeries[];
  line?: { label: string; color: string; values: (number | null)[] }; // 0..1
  onMonth?: (m: string) => void;
  activeMonth?: string | null;
  format: (n: number) => string;
  height?: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = bars.filter((b) => !hidden.has(b.key));
  const top = niceMax(Math.max(0, ...shown.flatMap((b) => b.values)));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const showLine = line && !hidden.has("__line");
  const n = months.length;
  const pts = showLine
    ? line!.values.map((v, i) => (v == null ? null : [((i + 0.5) / n) * 100, (1 - Math.min(1, v)) * 100] as const))
    : [];
  const path = pts.reduce((d, p, i) => (p ? d + `${d && pts[i - 1] ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)} ` : d), "");

  if (!n) return <p className="py-10 text-center text-[13px] text-muted-fg">No months in range.</p>;
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative w-11 shrink-0 text-right text-[10.5px] tabular-nums text-muted-fg" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>{compactNum(top * t)}</span>
          ))}
        </div>
        <div className={cn("min-w-0 flex-1 overflow-x-auto scrollbar-none", line && "pr-8")}>
          <div style={{ minWidth: n * (shown.length > 1 ? 30 : 22) }}>
            <div className="relative" style={{ height }}>
              {ticks.map((t) => (
                <div key={t} className={cn("absolute inset-x-0 border-t", t === 0 ? "border-border" : "border-dashed border-line-subtle")} style={{ top: `${(1 - t) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex">
                {months.map((m, i) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => onMonth?.(m)}
                    className={cn(
                      "group relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-md px-[2px] transition-colors hover:bg-muted/60",
                      activeMonth === m && "bg-primary-soft"
                    )}
                    aria-label={`${monthLabel(m)} — filter to this month`}
                  >
                    {shown.map((b) => (
                      <span key={b.key} className="w-full max-w-[16px] rounded-t-[3px]" style={{ height: `${Math.max(0, (b.values[i]! / top) * 100)}%`, background: b.color }} />
                    ))}
                    <span className={cn("pointer-events-none absolute top-1 z-10 hidden whitespace-nowrap rounded-md border border-border bg-raised px-2.5 py-1.5 text-left text-[11.5px] shadow-token-md group-hover:block", i < n / 2 ? "left-full ml-1" : "right-full mr-1")}>
                      <span className="mb-0.5 block text-muted-fg">{monthLabel(m)}</span>
                      {bars.map((b) => (
                        <span key={b.key} className="flex items-center gap-1.5"><Dot color={b.color} />{b.label}<span className="ml-auto pl-3 font-medium tabular-nums">{format(b.values[i]!)}</span></span>
                      ))}
                      {line && line.values[i] != null && (
                        <span className="flex items-center gap-1.5"><Dot color={line.color} />{line.label}<span className="ml-auto pl-3 font-medium tabular-nums">{Math.round((line.values[i] ?? 0) * 100)}%</span></span>
                      )}
                      {onMonth && <span className="mt-1 block text-[10.5px] text-muted-fg">Click to zoom into this month</span>}
                    </span>
                  </button>
                ))}
              </div>
              {showLine && path && (
                <div className="pointer-events-none absolute -right-1 inset-y-0 translate-x-full text-[10px] tabular-nums" style={{ color: line!.color }}>
                  {[1, 0.5, 0].map((t) => (
                    <span key={t} className="absolute -translate-y-1/2 pl-1" style={{ top: `${(1 - t) * 100}%` }}>{t * 100}%</span>
                  ))}
                </div>
              )}
              {showLine && path && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={path} fill="none" stroke={line!.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div className="mt-1.5 flex">
              {months.map((m, i) => (
                <div key={m} className="flex-1 truncate text-center text-[10px] text-muted-fg">{n > 14 && i % Math.ceil(n / 12) ? "" : monthLabel(m, n > 6 || m.endsWith("-01"))}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-[52px] text-[12px]">
        {bars.map((b) => (
          <button key={b.key} type="button" onClick={() => setHidden((h) => { const x = new Set(h); x.has(b.key) ? x.delete(b.key) : x.add(b.key); return x; })} className={cn("inline-flex items-center gap-1.5", hidden.has(b.key) ? "text-disabled line-through" : "text-muted-fg hover:text-fg")}>
            <Dot color={b.color} />{b.label}
          </button>
        ))}
        {line && (
          <button type="button" onClick={() => setHidden((h) => { const x = new Set(h); x.has("__line") ? x.delete("__line") : x.add("__line"); return x; })} className={cn("inline-flex items-center gap-1.5", hidden.has("__line") ? "text-disabled line-through" : "text-muted-fg hover:text-fg")}>
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: line.color }} />{line.label} (right axis)
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Ranking bars (click to drill / filter) ─────────────────────────────────

export type RankItem = { key: string; label: string; sub?: string; value: number; display: string };

export function RankBars({
  items,
  selected,
  onPick,
  limit = 10,
  color = "rgb(var(--c-brand))",
  negativeColor = "rgb(var(--c-danger))",
  empty = "Nothing to rank.",
}: {
  items: RankItem[];
  selected?: Set<string>;
  onPick?: (key: string) => void;
  limit?: number;
  color?: string;
  negativeColor?: string;
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  const list = all ? items : items.slice(0, limit);
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value))) || 1;
  if (!items.length) return <p className="py-8 text-center text-[13px] text-muted-fg">{empty}</p>;
  return (
    <div>
      <ul className="space-y-0.5">
        {list.map((it) => {
          const on = selected?.has(it.key);
          return (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => onPick?.(it.key)}
                className={cn("group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60", on && "bg-primary-soft")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-fg">{it.label}</span>
                  {it.sub && <span className="block truncate text-[11px] text-muted-fg">{it.sub}</span>}
                </span>
                <span className="text-right text-[12.5px] font-medium tabular-nums text-fg">{it.display}</span>
                <span className="col-span-2 mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(1.5, (Math.abs(it.value) / max) * 100)}%`, background: it.value < 0 ? negativeColor : color }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > limit && (
        <button type="button" className="btn-ghost btn-sm mt-1" onClick={() => setAll((v) => !v)}>
          {all ? "Show top " + limit : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

// ─── Stacked horizontal bar (aging) ─────────────────────────────────────────

export function StackBar({
  parts,
  active,
  onPick,
  format,
}: {
  parts: { key: string; label: string; value: number; count?: number; color: string }[];
  active?: string | null;
  onPick?: (key: string) => void;
  format: (n: number) => string;
}) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  if (total <= 0) return <p className="py-6 text-center text-[13px] text-muted-fg">Nothing overdue.</p>;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        {parts.filter((p) => p.value > 0).map((p) => (
          <button
            type="button"
            key={p.key}
            title={`${p.label}: ${format(p.value)}`}
            onClick={() => onPick?.(p.key)}
            className={cn("h-full transition-opacity hover:opacity-80", active && active !== p.key && "opacity-35")}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {parts.map((p) => (
          <li key={p.key}>
            <button type="button" onClick={() => onPick?.(p.key)} className={cn("w-full rounded-md px-1.5 py-1 text-left hover:bg-muted/60", active === p.key && "bg-primary-soft")}>
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-fg"><Dot color={p.color} />{p.label}</span>
              <span className="block text-[13px] font-medium tabular-nums text-fg">{format(p.value)}</span>
              {p.count != null && <span className="block text-[11px] text-muted-fg">{p.count} item{p.count === 1 ? "" : "s"}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

export function Spark({ values, color = "rgb(var(--c-brand))", className }: { values: (number | null)[]; color?: string; className?: string }) {
  const v = values.map((x) => x ?? 0);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${30 - ((x - min) / r) * 26 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden>
      <polyline points={`0,30 ${pts} 100,30`} fill={color} fillOpacity="0.08" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Small horizontal list bars (mix) ───────────────────────────────────────

export function MixList({ rows, format, color = "rgb(var(--c-brand))" }: { rows: { label: string; value: number; sub?: string }[]; format: (n: number) => string; color?: string }) {
  const total = rows.reduce((t, r) => t + r.value, 0);
  if (!rows.length || total <= 0) return <p className="py-6 text-center text-[13px] text-muted-fg">Nothing in this selection.</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate capitalize text-fg">{r.label}{r.sub && <span className="ml-1 text-[11px] normal-case text-muted-fg">{r.sub}</span>}</span>
            <span className="shrink-0 tabular-nums text-fg">{format(r.value)} <span className="text-[11px] text-muted-fg">{Math.round((r.value / total) * 100)}%</span></span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
