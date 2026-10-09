// Charts in plain HTML/SVG: server-rendered, no JS, no dependencies.
// Colours come from the --chart-* tokens in app/globals.css.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25-03" (yy-mm) → "Mar 25"; anything else is shown as given. */
function monthLabel(s: string): string {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** 1234567 → "1.2M", 45200 → "45K": for axis ticks only. */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** A round axis maximum above `max` (1, 2, 2.5, 5 × 10^n). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--chart-1)",
  fillOpacity = 0.15,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}) {
  if (!data.length) return <div className="text-xs text-muted-fg">—</div>;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / range) * height] as const);
  const pathLine = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const pathArea = pathLine + ` L${width} ${height} L0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" preserveAspectRatio="none">
      <path d={pathArea} fill={color} fillOpacity={fillOpacity} />
      <path d={pathLine} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Horizontal bars, one per row, label on the left and value on the right. */
export function BarChart({
  data,
  color = "var(--chart-1)",
  formatValue = (n: number) => n.toLocaleString(),
  formatLabel = (s: string) => s,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
  formatLabel?: (s: string) => string;
}) {
  if (!data.length) return <p className="text-[13px] text-muted-fg">No data.</p>;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0) || 1;
  return (
    <div className="space-y-1.5">
      {data.map((d) => {
        const positive = d.value >= 0;
        const pct = (Math.abs(d.value) / max) * 100;
        return (
          <div key={d.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-[12px]">
            <div className="truncate text-fg-soft" title={d.label}>{formatLabel(d.label)}</div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, 1)}%`, background: positive ? color : "rgb(var(--c-danger))" }}
              />
            </div>
            <div className={positive ? "tabular-nums" : "tabular-nums text-danger"}>{formatValue(d.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Collected vs costs per month: paired bars on a light grid with a value axis.
 * Hovering a month shows both figures.
 */
export function StackedBarTrend({
  data,
  height = 200,
  formatValue = (n: number) => n.toLocaleString(),
}: {
  data: { label: string; collected: number; costs: number }[];
  height?: number;
  formatValue?: (n: number) => string;
}) {
  if (!data.length) return <p className="p-4 text-[13px] text-muted-fg">No data.</p>;
  const top = niceMax(Math.max(...data.flatMap((d) => [d.collected, d.costs]), 0));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const pct = (v: number) => `${Math.max(0, (v / top) * 100)}%`;
  const empty = data.every((d) => !d.collected && !d.costs);

  return (
    <div>
      <div className="flex gap-2">
        {/* value axis */}
        <div className="relative w-11 shrink-0 text-right text-[10.5px] tabular-nums text-muted-fg" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
              {compact(top * t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-visible scrollbar-none">
          <div style={{ minWidth: data.length * 34 }}>
            <div className="relative" style={{ height }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className={t === 0 ? "absolute inset-x-0 border-t border-border" : "absolute inset-x-0 border-t border-dashed border-line-subtle"}
                  style={{ top: `${(1 - t) * 100}%` }}
                />
              ))}
              {empty && (
                <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-muted-fg">
                  Nothing collected or spent in this period.
                </div>
              )}
              <div className="absolute inset-0 flex">
                {data.map((d, i) => (
                  <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center gap-[3px] rounded-t-md px-[3px] transition-colors hover:bg-muted/50">
                    <div
                      className="w-full max-w-[18px] rounded-t-[3px] bg-[color:var(--chart-1)] transition-opacity group-hover:opacity-90"
                      style={{ height: pct(d.collected) }}
                    />
                    <div
                      className="w-full max-w-[18px] rounded-t-[3px] bg-[color:var(--chart-2)] transition-opacity group-hover:opacity-90"
                      style={{ height: pct(d.costs) }}
                    />
                    <div className={`pointer-events-none absolute top-1 z-10 hidden whitespace-nowrap group-hover:block ${i < data.length / 2 ? "left-full ml-1" : "right-full mr-1"}`}><div className="rounded-md border border-border bg-raised px-2.5 py-1.5 text-[11.5px] shadow-token-md">
                      <div className="mb-0.5 text-muted-fg">{monthLabel(d.label)}</div>
                      <div className="flex items-center gap-1.5"><Dot color="var(--chart-1)" /> Collected <span className="ml-auto pl-3 font-medium tabular-nums">{formatValue(d.collected)}</span></div>
                      <div className="flex items-center gap-1.5"><Dot color="var(--chart-2)" /> Costs <span className="ml-auto pl-3 font-medium tabular-nums">{formatValue(d.costs)}</span></div>
                    </div></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1.5 flex">
              {data.map((d) => (
                <div key={d.label} className="flex-1 truncate text-center text-[10.5px] text-muted-fg">{monthLabel(d.label)}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-4 pl-[52px] text-[12px] text-muted-fg">
        <span className="inline-flex items-center gap-1.5"><Dot color="var(--chart-1)" />Collected</span>
        <span className="inline-flex items-center gap-1.5"><Dot color="var(--chart-2)" />Costs</span>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];

/** Share of a whole: a ring with the total in the middle and a legend beside it. */
export function DonutChart({
  data,
  size = 140,
  thickness = 22,
  formatValue = (n: number) => n.toLocaleString(),
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  if (total <= 0) return <p className="text-[13px] text-muted-fg">No data.</p>;
  const r = size / 2;
  const innerR = r - thickness;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 0.012 : 0; // radians between slices

  let acc = 0;
  const slices = data
    .filter((d) => d.value > 0)
    .map((d, i) => {
      const start = (acc / total) * 2 * Math.PI + gap / 2;
      acc += d.value;
      const end = Math.max(start + 0.001, (acc / total) * 2 * Math.PI - gap / 2);
      const large = end - start > Math.PI ? 1 : 0;
      const full = end - start >= 2 * Math.PI - 0.0001;
      const e = full ? end - 0.0001 : end;
      const x1 = r + r * Math.sin(start), y1 = r - r * Math.cos(start);
      const x2 = r + r * Math.sin(e), y2 = r - r * Math.cos(e);
      const xi1 = r + innerR * Math.sin(e), yi1 = r - innerR * Math.cos(e);
      const xi2 = r + innerR * Math.sin(start), yi2 = r - innerR * Math.cos(start);
      const path = `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi1} ${yi1} A${innerR} ${innerR} 0 ${large} 0 ${xi2} ${yi2} Z`;
      return { path, color: d.color ?? PALETTE[i % PALETTE.length], label: d.label, value: d.value };
    });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} className="transition-opacity hover:opacity-80">
              <title>{`${s.label}: ${formatValue(s.value)}`}</title>
            </path>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-fg">Total</span>
          <span className="max-w-[80px] truncate text-[12.5px] font-medium tabular-nums text-fg">{compact(total)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-[12.5px]">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <Dot color={s.color} />
            <span className="flex-1 truncate capitalize text-fg-soft">{s.label}</span>
            <span className="font-medium tabular-nums text-fg">{formatValue(s.value)}</span>
            <span className="w-9 text-right tabular-nums text-muted-fg">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
