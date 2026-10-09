"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight, ArrowUpRight, Bookmark, Check, Download, ExternalLink, Info, Lightbulb, Link2, Settings2, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money, fmtDate } from "@/lib/format";
import { methodLabel } from "@/lib/payment-methods";
import type { Facts } from "@/lib/analytics/types";
import {
  AGING, aging, breakdown, chargesByCategory, costsByCategory, expiryTimeline, forecast, insights, metrics, monthly,
  overdueItems, paymentMix, presetRange, previousRange, PRESETS, scopeOf, serviceChargeLiability,
  type Dim, type DimRow, type Filters, type Metrics,
} from "@/lib/analytics/compute";
import { DonutChart } from "@/components/Charts";
import { MixList, RankBars, Spark, StackBar, TrendChart, compactNum, monthLabel, Dot } from "./charts";
import { MultiSelect, PeriodPicker } from "./filters";

// ─── Widgets & customisation ────────────────────────────────────────────────

const WIDGETS = [
  { id: "insights", label: "Insights" },
  { id: "trend", label: "Billed vs received trend" },
  { id: "breakdown", label: "Ranking & drill-down" },
  { id: "aging", label: "Overdue aging" },
  { id: "leases", label: "Occupancy & lease expiries" },
  { id: "forecast", label: "Cash-flow forecast" },
  { id: "payments", label: "Payment methods & staff" },
  { id: "costs", label: "Costs & lessee charges" },
  { id: "table", label: "Detailed table" },
] as const;
type WidgetId = (typeof WIDGETS)[number]["id"];

const WIDGET_KEY = "variaka-analytics-widgets-v1";
const VIEWS_KEY = "variaka-analytics-views-v1";
const readLS = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const writeLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// ─── Metrics a ranking / table can sort by ──────────────────────────────────

type MetricKey = "outstanding" | "received" | "billed" | "collectionRate" | "net" | "yieldPct" | "occupancy" | "monthlyRent" | "valuation" | "oldestDays";
const METRICS: { key: MetricKey; label: string; kind: "money" | "pct" | "days" }[] = [
  { key: "outstanding", label: "Outstanding", kind: "money" },
  { key: "received", label: "Rent received", kind: "money" },
  { key: "billed", label: "Rent billed", kind: "money" },
  { key: "collectionRate", label: "Collection rate", kind: "pct" },
  { key: "net", label: "Net income", kind: "money" },
  { key: "yieldPct", label: "Yield (annualised)", kind: "pct" },
  { key: "occupancy", label: "Occupancy", kind: "pct" },
  { key: "monthlyRent", label: "Rent roll / month", kind: "money" },
  { key: "valuation", label: "Valuation", kind: "money" },
  { key: "oldestDays", label: "Oldest overdue (days)", kind: "days" },
];
const fmtMetric = (k: MetricKey, v: number | null) => {
  const m = METRICS.find((x) => x.key === k)!;
  if (v == null) return "—";
  return m.kind === "money" ? money(v) : m.kind === "pct" ? `${(v * 100).toFixed(m.key === "yieldPct" ? 1 : 0)}%` : `${Math.round(v)}d`;
};
const val = (m: Metrics, k: MetricKey) => (m[k] ?? null) as number | null;

const DIM_LABEL: Record<Dim, string> = { compound: "Compounds", property: "Properties", lessee: "Clients" };
const NEXT_DIM: Record<Dim, Dim | null> = { compound: "property", property: "lessee", lessee: null };

// ─── URL <-> filters ────────────────────────────────────────────────────────

export type Lock = { compounds?: string[]; properties?: string[]; lessees?: string[] };

function decode(q: Record<string, string | undefined>, f: Facts, lock?: Lock): { flt: Filters; dim: Dim } {
  const idsTo = (ids: string[] | undefined, list: { id: string }[]) => (ids ?? []).map((id) => list.findIndex((x) => x.id === id)).filter((i) => i >= 0);
  const split = (s?: string, sep = ",") => (s ? s.split(sep).filter(Boolean) : []);
  const preset = q.range && [...PRESETS.map((p) => p.key), "custom"].includes(q.range) ? q.range : "12m";
  const r = preset === "custom" && q.from && q.to ? { from: q.from, to: q.to } : presetRange(preset === "custom" ? "12m" : preset, f.today, f);
  const flt: Filters = {
    preset: preset === "custom" && !(q.from && q.to) ? "12m" : preset,
    ...r,
    compounds: idsTo(lock?.compounds ?? split(q.c), f.compounds),
    properties: idsTo(lock?.properties ?? split(q.p), f.properties),
    lessees: lock?.lessees ?? split(q.l, "~"),
    staff: idsTo(split(q.s), f.people),
    compare: q.cmp !== "0",
  };
  const dim = (["compound", "property", "lessee"] as Dim[]).includes(q.dim as Dim) ? (q.dim as Dim)
    : flt.properties.length ? "lessee" : flt.compounds.length ? "property" : "compound";
  return { flt, dim };
}

function encode(flt: Filters, dim: Dim, f: Facts): string {
  const p = new URLSearchParams();
  if (flt.preset !== "12m") p.set("range", flt.preset);
  if (flt.preset === "custom") { p.set("from", flt.from); p.set("to", flt.to); }
  if (flt.compounds.length) p.set("c", flt.compounds.map((i) => f.compounds[i]!.id).join(","));
  if (flt.properties.length) p.set("p", flt.properties.map((i) => f.properties[i]!.id).join(","));
  if (flt.lessees.length) p.set("l", flt.lessees.join("~"));
  if (flt.staff.length) p.set("s", flt.staff.map((i) => f.people[i]!.id).join(","));
  if (!flt.compare) p.set("cmp", "0");
  p.set("dim", dim);
  return p.toString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AnalyticsDashboard({
  facts: f,
  query = {},
  lock,
  embedded = false,
  links = { rent: true },
}: {
  facts: Facts;
  query?: Record<string, string | undefined>;
  /** Fixed scope (compound / property / lease pages). */
  lock?: Lock;
  /** Inside another page: no URL sync, fewer widgets by default. */
  embedded?: boolean;
  links?: { rent?: boolean };
}) {
  const initial = useMemo(() => decode(query, f, lock), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [flt, setFlt] = useState<Filters>(initial.flt);
  const [dim, setDim] = useState<Dim>(initial.dim);
  const [rankBy, setRankBy] = useState<MetricKey>("outstanding");
  const [bucket, setBucket] = useState<string | null>(null);
  const [expMonth, setExpMonth] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: MetricKey | "label"; dir: 1 | -1 }>({ key: "outstanding", dir: -1 });
  const [moreKpis, setMoreKpis] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const lockedC = Boolean(lock?.compounds), lockedP = Boolean(lock?.properties), lockedL = Boolean(lock?.lessees);
  const dims = (["compound", "property", "lessee"] as Dim[]).filter((d) => !(d === "compound" && (lockedC || lockedP || lockedL)) && !(d === "property" && (lockedP || lockedL)));

  // widgets (per browser)
  const defaultWidgets: Record<WidgetId, boolean> = Object.fromEntries(WIDGETS.map((w) => [w.id, embedded ? ["insights", "trend", "breakdown", "aging", "leases"].includes(w.id) : true])) as Record<WidgetId, boolean>;
  const [widgets, setWidgets] = useState(defaultWidgets);
  const [views, setViews] = useState<{ name: string; qs: string }[]>([]);
  useEffect(() => {
    if (!embedded) setWidgets((w) => ({ ...w, ...readLS(WIDGET_KEY, {}) }));
    setViews(readLS(VIEWS_KEY, []));
  }, [embedded]);
  const toggleWidget = (id: WidgetId) => setWidgets((w) => { const n = { ...w, [id]: !w[id] }; if (!embedded) writeLS(WIDGET_KEY, n); return n; });

  // URL sync (standalone dashboard only)
  const qs = useMemo(() => encode(flt, dim, f), [flt, dim, f]);
  useEffect(() => {
    if (embedded) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
  }, [qs, embedded]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const patch = useCallback((p: Partial<Filters>) => setFlt((cur) => ({ ...cur, ...p })), []);

  // ── computations ──
  const scope = useMemo(() => scopeOf(f, flt), [f, flt]);
  const cur = useMemo(() => metrics(f, scope, flt.from, flt.to, flt.staff), [f, scope, flt]);
  const prevRange = useMemo(() => previousRange(flt.from, flt.to), [flt.from, flt.to]);
  const prev = useMemo(() => (flt.compare ? metrics(f, scope, prevRange.from, prevRange.to, flt.staff) : null), [f, scope, flt, prevRange]);
  const series = useMemo(() => monthly(f, scope, flt.from, flt.to, flt.staff), [f, scope, flt]);
  const rows = useMemo(() => breakdown(f, flt, dim), [f, flt, dim]);
  const byLessee = useMemo(() => (dim === "lessee" ? rows : breakdown(f, flt, "lessee")), [f, flt, dim, rows]);
  const byProperty = useMemo(() => (dim === "property" ? rows : breakdown(f, flt, "property")), [f, flt, dim, rows]);
  const items = useMemo(() => overdueItems(f, scope), [f, scope]);
  const agingParts = useMemo(() => aging(items), [items]);
  const notes = useMemo(() => insights(f, flt, cur, prev, byLessee, byProperty, items), [f, flt, cur, prev, byLessee, byProperty, items]);
  const expiries = useMemo(() => expiryTimeline(f, scope), [f, scope]);
  const fc = useMemo(() => forecast(f, scope), [f, scope]);
  const mix = useMemo(() => paymentMix(f, scope, flt.from, flt.to, flt.staff), [f, scope, flt]);
  const costCats = useMemo(() => costsByCategory(f, scope, flt.from, flt.to), [f, scope, flt]);
  const chargeCats = useMemo(() => chargesByCategory(f, scope, flt.from, flt.to), [f, scope, flt]);
  const sc = useMemo(() => serviceChargeLiability(f, scope), [f, scope]);

  // ── interactions ──
  const drill = (key: string) => {
    if (dim === "compound") { patch({ compounds: [Number(key)], properties: [] }); setDim("property"); }
    else if (dim === "property") { patch({ properties: [Number(key)] }); setDim("lessee"); }
    else patch({ lessees: flt.lessees.includes(key) ? flt.lessees.filter((x) => x !== key) : [key] });
  };
  const zoomMonth = (m: string) => {
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    patch({ preset: "custom", from: m + "-01", to: last });
  };
  const clearAll = () => {
    const r = presetRange("12m", f.today, f);
    setFlt((c) => ({
      ...c, preset: "12m", ...r,
      compounds: lockedC ? c.compounds : [], properties: lockedP ? c.properties : [],
      lessees: lockedL ? c.lessees : [], staff: [],
    }));
    setDim(dims[0]!);
    setBucket(null);
  };

  const periodLabel = flt.preset === "custom" ? `${fmtDate(flt.from)} – ${fmtDate(flt.to)}` : PRESETS.find((p) => p.key === flt.preset)?.label ?? "";
  const propertyOptions = f.properties
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !flt.compounds.length || flt.compounds.includes(p.c))
    .filter(({ p, i }) => !p.archived || flt.properties.includes(i))
    .map(({ p, i }) => ({ value: String(i), label: p.name, sub: f.compounds[p.c]?.name }));
  const lesseeOptions = [...new Set([...scopeOf(f, { compounds: flt.compounds, properties: flt.properties, lessees: [] }).leases].map((l) => f.leases[l]!.lessee))]
    .sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));

  const chips: { label: string; onRemove?: () => void }[] = [
    ...flt.compounds.map((i) => ({ label: f.compounds[i]?.name ?? "?", onRemove: lockedC ? undefined : () => patch({ compounds: flt.compounds.filter((x) => x !== i) }) })),
    ...flt.properties.map((i) => ({ label: f.properties[i]?.name ?? "?", onRemove: lockedP ? undefined : () => patch({ properties: flt.properties.filter((x) => x !== i) }) })),
    ...flt.lessees.map((n) => ({ label: n, onRemove: lockedL ? undefined : () => patch({ lessees: flt.lessees.filter((x) => x !== n) }) })),
    ...flt.staff.map((i) => ({ label: `Recorded by ${f.people[i]?.name}`, onRemove: () => patch({ staff: flt.staff.filter((x) => x !== i) }) })),
  ];
  const removable = chips.some((c) => c.onRemove) || flt.preset !== "12m";

  // ── table ──
  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (sort.key === "label") return a.label.localeCompare(b.label, undefined, { numeric: true }) * sort.dir;
      return ((val(a.m, sort.key) ?? -Infinity) - (val(b.m, sort.key) ?? -Infinity)) * sort.dir;
    });
    return arr;
  }, [rows, sort]);
  const exportCsv = () => {
    const head = [DIM_LABEL[dim].replace(/s$/, ""), "Detail", "Units", "Occupancy %", "Rent roll / mo", "Billed", "Received", "Collection %", "Outstanding", "Oldest overdue (days)", "Costs", "Net", "Yield %", "Valuation"];
    const lines = sortedRows.map((r) => [
      r.label, r.sub ?? "", r.m.units, r.m.occupancy != null ? Math.round(r.m.occupancy * 100) : "", Math.round(r.m.monthlyRent),
      Math.round(r.m.billed), Math.round(r.m.received), r.m.collectionRate != null ? Math.round(r.m.collectionRate * 100) : "",
      Math.round(r.m.outstanding), r.m.oldestDays, Math.round(r.m.costs), Math.round(r.m.net),
      r.m.yieldPct != null ? (r.m.yieldPct * 100).toFixed(2) : "", Math.round(r.m.valuation),
    ]);
    const csv = [head, ...lines].map((l) => l.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `variaka-${dim}-${flt.from}-to-${flt.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveView = () => {
    const name = window.prompt("Name this view", chips.map((c) => c.label).join(", ") || periodLabel);
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, qs }];
    setViews(next); writeLS(VIEWS_KEY, next); setToast(`Saved “${name}”`);
  };
  const applyView = (v: { qs: string }) => {
    const q = Object.fromEntries(new URLSearchParams(v.qs));
    const d = decode(q, f, lock);
    setFlt(d.flt); setDim(dims.includes(d.dim) ? d.dim : dims[0]!);
  };

  const show = (id: WidgetId) => widgets[id];
  const visibleRanked = rows
    .map((r) => ({ r, v: val(r.m, rankBy) }))
    .filter(({ v, r }) => v != null && (rankBy !== "outstanding" || v > 0) && (rankBy !== "oldestDays" || r.m.outstanding > 0))
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  const selectedKeys = new Set<string>(dim === "compound" ? flt.compounds.map(String) : dim === "property" ? flt.properties.map(String) : flt.lessees);

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            preset={flt.preset} from={flt.from} to={flt.to} compare={flt.compare} label={periodLabel}
            onChange={({ preset, from, to }) => patch(preset === "custom" ? { preset, from: from!, to: to! } : { preset, ...presetRange(preset, f.today, f) })}
            onCompare={(v) => patch({ compare: v })}
          />
          {!lockedC && !lockedP && !lockedL && (
            <MultiSelect label="Compound" options={f.compounds.map((c, i) => ({ value: String(i), label: c.name }))}
              value={flt.compounds.map(String)} onChange={(v) => { patch({ compounds: v.map(Number), properties: [] }); if (v.length && dim === "compound") setDim("property"); }} />
          )}
          {!lockedP && !lockedL && (
            <MultiSelect label="Property" options={propertyOptions} value={flt.properties.map(String)}
              onChange={(v) => { patch({ properties: v.map(Number) }); if (v.length && dim !== "lessee") setDim("lessee"); }} />
          )}
          {!lockedL && <MultiSelect label="Client" options={lesseeOptions} value={flt.lessees} onChange={(v) => patch({ lessees: v })} />}
          <MultiSelect label="Recorded by" options={f.people.map((p, i) => ({ value: String(i), label: p.name }))} value={flt.staff.map(String)} onChange={(v) => patch({ staff: v.map(Number) })} />

          <div className="ml-auto flex flex-wrap items-center gap-1">
            {!embedded && (
              <>
                <ViewsMenu views={views} onApply={applyView} onSave={saveView} onDelete={(name) => { const n = views.filter((v) => v.name !== name); setViews(n); writeLS(VIEWS_KEY, n); }} />
                <button type="button" className="btn-ghost h-8" title="Copy a link to this exact view" onClick={async () => { await navigator.clipboard.writeText(window.location.href); setToast("Link copied"); }}>
                  <Link2 size={14} /> <span className="hidden sm:inline">Share</span>
                </button>
              </>
            )}
            <CustomizeMenu widgets={widgets} onToggle={toggleWidget} />
          </div>
        </div>
        {(chips.length > 0 || removable) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1 text-[12px] text-fg">
                {c.label}
                {c.onRemove ? (
                  <button type="button" onClick={c.onRemove} className="rounded-full p-0.5 text-muted-fg hover:bg-muted hover:text-fg" aria-label={`Remove ${c.label}`}><X size={12} /></button>
                ) : <span className="pr-1.5" />}
              </span>
            ))}
            {removable && <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={clearAll}>Reset</button>}
            {flt.compare && <span className="text-[11.5px] text-muted-fg">· compared with {fmtDate(prevRange.from)} – {fmtDate(prevRange.to)}</span>}
          </div>
        )}
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <KpiCard label="Rent received" value={money(cur.received)} delta={delta(cur.received, prev?.received)} spark={series.map((s) => s.received)}
          hint={`${money(cur.chargesReceived)} charges · ${money(cur.depositsReceived)} deposits`} info="Rent money received in the period (payment log, by the date it was paid)." />
        <KpiCard label="Collection rate" value={cur.collectionRate != null ? `${Math.round(cur.collectionRate * 100)}%` : "—"}
          delta={ptsDelta(cur.collectionRate, prev?.collectionRate)} spark={series.map((s) => s.rate)}
          tone={cur.collectionRate != null && cur.collectionRate < 0.8 ? "warning" : undefined}
          hint={`${money(cur.billedPaid)} of ${money(cur.billed)} billed`} info="Share of the rent that fell due in the period which has since been paid." />
        <KpiCard label="Outstanding now" value={money(cur.outstanding)} tone={cur.outstanding > 0 ? "danger" : "success"}
          hint={`${cur.overdueLessees} client${cur.overdueLessees === 1 ? "" : "s"} · oldest ${cur.oldestDays}d`} info="Unpaid rent already due, as of today (not limited to the period)."
          onClick={() => document.getElementById("w-aging")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        <KpiCard label="Net income" value={money(cur.net)} delta={delta(cur.net, prev?.net)} tone={cur.net < 0 ? "danger" : undefined}
          hint={`${money(cur.received)} in − ${money(cur.costs)} costs`} info="Rent received minus landlord costs in the period." />
        <KpiCard label="Occupancy" value={cur.occupancy != null ? `${Math.round(cur.occupancy * 100)}%` : "—"} delta={ptsDelta(cur.occupancy, prev?.occupancy)}
          hint={`${cur.leased} of ${cur.units} units · ${Math.round(cur.leasedSqft).toLocaleString()} sqft let`} info="Units with a lease running on the last day of the period (or today)." />
        <KpiCard label="Rent roll / month" value={money(cur.monthlyRent)} delta={delta(cur.monthlyRent, prev?.monthlyRent)}
          hint={cur.rentPerSqft ? `Ksh ${cur.rentPerSqft.toFixed(1)} per sqft` : undefined} info="Monthly rent of the leases running at the end of the period." />
        <KpiCard label="Yield (annualised)" value={cur.yieldPct != null ? `${(cur.yieldPct * 100).toFixed(2)}%` : "—"} delta={ptsDelta(cur.yieldPct, prev?.yieldPct, 2)}
          hint={`On ${money(cur.valuation)} valuation`} info="Net income ÷ portfolio valuation, scaled to a year." />
        <KpiCard label="Deposits short" value={money(cur.depositShortfall)} tone={cur.depositShortfall > 0 ? "warning" : undefined}
          hint={`${money(cur.depositsHeld)} held`} info="Deposits charged but not yet received, on active leases." />
        {moreKpis && (
          <>
            <KpiCard label="Lessee charges due" value={money(cur.chargesOutstanding)} hint={`${money(cur.chargesBilled)} billed in period`} info="Water, electricity and other charges billed to lessees that are unpaid and due." />
            <KpiCard label="Service charges pending" value={money(sc.pending)} hint={`${sc.pendingCount} months · owed to managements`} info="Service charges owed to compound managements that haven't been paid yet." />
            <KpiCard label="Leases ending ≤ 90d" value={String(cur.expiring90)} hint={`${money(cur.expiring90Rent)}/mo at risk`} info="Active leases whose end date is within 90 days." />
            <KpiCard label="Paid on time" value={cur.onTimePct != null ? `${Math.round(cur.onTimePct * 100)}%` : "—"}
              hint={cur.punctualPayments ? `${cur.punctualPayments} payments · avg ${Math.round(cur.avgDaysLate ?? 0)}d late` : "Builds up as payments are recorded"}
              info="Of rent payments recorded in the payment log, the share paid within 5 days of the due date. Imported history isn't counted." />
          </>
        )}
      </div>
      <button type="button" className="btn-ghost btn-sm -mt-3" onClick={() => setMoreKpis((v) => !v)}>{moreKpis ? "Fewer metrics" : "More metrics"}</button>

      {/* ── Insights ── */}
      {show("insights") && (
        <Widget title="Insights" icon={<Lightbulb size={14} className="text-primary" />}>
          <ul className="divide-y divide-line-subtle">
            {notes.map((n, i) => (
              <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.tone === "good" ? "bg-success" : n.tone === "bad" ? "bg-danger" : n.tone === "warn" ? "bg-warning" : "bg-primary")} />
                <span className="min-w-0 flex-1 text-fg">{n.text}</span>
                {n.action && (
                  <button type="button" className="btn-ghost btn-sm ml-5 sm:ml-0" onClick={() => { const { dim: d, ...p } = n.action!.patch; patch(p); if (p.lessees) setDim("lessee"); if (p.properties) setDim("lessee"); if (d) setDim(d); }}>
                    {n.action.label} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Widget>
      )}

      {/* ── Trend ── */}
      {show("trend") && (
        <Widget title="Billed vs received" sub={`${periodLabel} · click a month to zoom in`}>
          <div className="p-4">
            <TrendChart
              months={series.map((s) => s.month)}
              bars={[
                { key: "billed", label: "Rent billed", color: "var(--chart-2)", values: series.map((s) => s.billed) },
                { key: "received", label: "Rent received", color: "var(--chart-1)", values: series.map((s) => s.received) },
                ...(cur.costs > 0 ? [{ key: "costs", label: "Costs", color: "var(--chart-5)", values: series.map((s) => s.costs) }] : []),
              ]}
              line={{ label: "Collection rate", color: "rgb(var(--c-success))", values: series.map((s) => s.rate) }}
              onMonth={zoomMonth}
              activeMonth={flt.preset === "custom" && flt.from.endsWith("-01") && flt.from.slice(0, 7) === flt.to.slice(0, 7) ? flt.from.slice(0, 7) : null}
              format={money}
            />
          </div>
        </Widget>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        {/* ── Ranking / drill-down ── */}
        {show("breakdown") && (
          <Widget
            title={`Top ${DIM_LABEL[dim].toLowerCase()}`}
            sub={NEXT_DIM[dim] ? `Click to drill into its ${DIM_LABEL[NEXT_DIM[dim]!].toLowerCase()}` : "Click to focus on a client"}
            right={
              <select className="input h-8 w-auto !py-0 text-[12px]" value={rankBy} onChange={(e) => setRankBy(e.target.value as MetricKey)} aria-label="Rank by">
                {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            }
          >
            <div className="px-4 pt-3">
              <DimTabs dims={dims} dim={dim} onDim={setDim} />
            </div>
            <div className="p-2 pt-2">
              <RankBars
                items={visibleRanked.map(({ r, v }) => ({ key: r.key, label: r.label, sub: r.sub, value: v ?? 0, display: fmtMetric(rankBy, v) }))}
                selected={selectedKeys}
                onPick={drill}
                color={rankBy === "outstanding" || rankBy === "oldestDays" ? "rgb(var(--c-danger))" : "rgb(var(--c-brand))"}
                empty={rankBy === "outstanding" ? "Nobody owes anything here." : "Nothing to rank."}
              />
            </div>
          </Widget>
        )}

        {/* ── Aging ── */}
        {show("aging") && (
          <Widget id="w-aging" title="Overdue aging" sub={`${money(cur.outstanding)} unpaid rent · click a bucket to list it`}>
            <div className="p-4">
              <StackBar
                parts={agingParts.map((a, i) => ({ key: a.key, label: a.label, value: a.amount, count: a.count, color: ["#f5b041", "#ee8a3c", "#e06a32", "#c94a2c", "#992f22"][i]! }))}
                active={bucket}
                onPick={(k) => setBucket((b) => (b === k ? null : k))}
                format={money}
              />
              <OverdueList items={bucket ? items.filter((i) => { const b = AGING.find((x) => x.key === bucket)!; return i.days >= b.min && i.days <= b.max; }) : items} links={links.rent} onLessee={(n) => { patch({ lessees: [n] }); setDim("lessee"); }} />
            </div>
          </Widget>
        )}

        {/* ── Occupancy & expiries ── */}
        {show("leases") && (
          <Widget title="Occupancy & lease expiries" sub="Next 12 months · click a month to see which leases end">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center">
                <DonutChart size={120} thickness={16} data={[{ label: "Let", value: cur.leased, color: "rgb(var(--c-brand))" }, { label: "Vacant", value: Math.max(0, cur.units - cur.leased), color: "var(--chart-muted)" }]} formatValue={(n) => `${n} units`} />
              </div>
              <div>
                <div className="flex h-28 items-end gap-1">
                  {expiries.map((e) => {
                    const max = Math.max(1, ...expiries.map((x) => x.rent));
                    return (
                      <button type="button" key={e.month} onClick={() => setExpMonth((m) => (m === e.month ? null : e.month))} title={`${monthLabel(e.month)}: ${e.count} lease${e.count === 1 ? "" : "s"}, ${money(e.rent)}/mo`}
                        className={cn("group flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-t-md hover:bg-muted/60", expMonth === e.month && "bg-primary-soft")}>
                        {e.count > 0 && <span className="mb-0.5 text-[10px] font-medium tabular-nums text-fg">{e.count}</span>}
                        <span className="w-full max-w-[18px] rounded-t-[3px] bg-[color:var(--chart-3)]" style={{ height: `${(e.rent / max) * 80}%` }} />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 flex">{expiries.map((e) => <span key={e.month} className="min-w-0 flex-1 overflow-hidden text-center text-[9.5px] text-muted-fg">{monthLabel(e.month, false).slice(0, 3)}</span>)}</div>
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[12.5px]">
                  {(expMonth ? expiries.filter((e) => e.month === expMonth) : expiries).flatMap((e) => e.leases).slice(0, expMonth ? 50 : 6).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <Link href={`/leases/${l.id}`} className="min-w-0 truncate hover:underline"><span className="font-medium">{l.lessee}</span> <span className="text-muted-fg">· {l.property}</span></Link>
                      <span className="shrink-0 tabular-nums text-muted-fg">{fmtDate(l.end)} · {money(l.rent)}</span>
                    </li>
                  ))}
                  {!expiries.some((e) => e.count) && <li className="text-muted-fg">No leases end in the next 12 months.</li>}
                </ul>
              </div>
            </div>
          </Widget>
        )}

        {/* ── Forecast ── */}
        {show("forecast") && (
          <Widget title="Cash-flow forecast" sub="Rent still to come in, next 6 months">
            <div className="p-4">
              <TrendChart
                months={fc.map((x) => x.month)}
                bars={[{ key: "unpaid", label: "Still to collect", color: "var(--chart-1)", values: fc.map((x) => x.unpaid) }, { key: "due", label: "Billed", color: "var(--chart-2)", values: fc.map((x) => x.due) }]}
                format={money}
                height={160}
              />
              <p className="mt-2 text-[12px] text-muted-fg">Plus {money(cur.outstanding)} already overdue. Total expected: <span className="font-medium text-fg">{money(cur.outstanding + fc.reduce((t, x) => t + x.unpaid, 0))}</span>.</p>
            </div>
          </Widget>
        )}

        {/* ── Payments ── */}
        {show("payments") && (
          <Widget title="How money came in" sub={`${periodLabel} · click a person to filter`}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:grid-cols-2">
              <div>
                <div className="kpi-label mb-2">By method</div>
                <MixList rows={[...mix.byMethod].sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: methodLabel(m), value: v }))} format={money} />
              </div>
              <div>
                <div className="kpi-label mb-2">Recorded by</div>
                <ul className="space-y-1">
                  {[...mix.byPerson].sort((a, b) => b[1] - a[1]).map(([pi, v]) => (
                    <li key={pi}>
                      <button type="button" disabled={pi < 0} onClick={() => patch({ staff: flt.staff.includes(pi) ? flt.staff.filter((x) => x !== pi) : [pi] })}
                        className={cn("flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-muted/60", flt.staff.includes(pi) && "bg-primary-soft")}>
                        <span className="truncate">{pi >= 0 ? f.people[pi]?.name : "Imported (no user)"}</span>
                        <span className="tabular-nums">{money(v)}</span>
                      </button>
                    </li>
                  ))}
                  {!mix.byPerson.size && <li className="py-4 text-center text-[13px] text-muted-fg">No payments in this selection.</li>}
                </ul>
              </div>
            </div>
          </Widget>
        )}

        {/* ── Costs ── */}
        {show("costs") && (
          <Widget title="Costs & lessee charges" sub={periodLabel}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:grid-cols-2">
              <div>
                <div className="kpi-label mb-2">Landlord costs · {money(cur.costs)}</div>
                {costCats.length ? <MixList rows={costCats} format={money} color="var(--chart-5)" /> : <p className="py-6 text-center text-[13px] text-muted-fg">No landlord costs in this period.</p>}
              </div>
              <div>
                <div className="kpi-label mb-2">Billed to lessees · {money(cur.chargesBilled)}</div>
                {chargeCats.length ? (
                  <MixList rows={chargeCats.map((c) => ({ label: c.label, value: c.billed, sub: `${Math.round((c.collected / (c.billed || 1)) * 100)}% collected` }))} format={money} color="var(--chart-3)" />
                ) : <p className="py-6 text-center text-[13px] text-muted-fg">No lessee charges in this period.</p>}
              </div>
            </div>
          </Widget>
        )}
      </div>

      {/* ── Table ── */}
      {show("table") && (
        <Widget
          title={`${DIM_LABEL[dim]} in detail`}
          sub={`${rows.length} row${rows.length === 1 ? "" : "s"} · ${periodLabel}`}
          right={<button type="button" className="btn-secondary h-8" onClick={exportCsv}><Download size={13} /> <span className="hidden sm:inline">Export</span> CSV</button>}
        >
          <div className="px-4 pt-3"><DimTabs dims={dims} dim={dim} onDim={setDim} /></div>
          <div className="table-wrap mt-2">
            <table className="table">
              <thead>
                <tr>
                  <Th label={DIM_LABEL[dim].replace(/s$/, "")} k="label" sort={sort} setSort={setSort} />
                  <Th label="Occupancy" k="occupancy" sort={sort} setSort={setSort} right hide="lg" />
                  <Th label="Rent / mo" k="monthlyRent" sort={sort} setSort={setSort} right hide="md" />
                  <Th label="Billed" k="billed" sort={sort} setSort={setSort} right hide="lg" />
                  <Th label="Received" k="received" sort={sort} setSort={setSort} right hide="sm" />
                  <Th label="Collected %" k="collectionRate" sort={sort} setSort={setSort} right hide="md" />
                  <Th label="Outstanding" k="outstanding" sort={sort} setSort={setSort} right />
                  <Th label="Oldest" k="oldestDays" sort={sort} setSort={setSort} right hide="lg" />
                  <Th label="Net" k="net" sort={sort} setSort={setSort} right hide="xl" />
                  <Th label="Yield" k="yieldPct" sort={sort} setSort={setSort} right hide="xl" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.key} className={cn(selectedKeys.has(r.key) && "[&>td]:bg-primary-soft/60")}>
                    <td>
                      <div className="flex max-w-[11rem] items-start gap-1 sm:max-w-xs">
                        <button type="button" className="min-w-0 text-left" onClick={() => drill(r.key)} title={NEXT_DIM[dim] ? "Drill in" : "Focus"}>
                          <span className="block truncate font-medium hover:text-primary">{r.label}</span>
                          {r.sub && <span className="block truncate text-[11.5px] text-muted-fg">{r.sub}</span>}
                        </button>
                        {r.href && (dim !== "lessee" || links.rent) && (
                          <Link href={r.href} className="mt-0.5 shrink-0 text-muted-fg hover:text-primary" aria-label={`Open ${r.label}`}><ExternalLink size={12} /></Link>
                        )}
                      </div>
                    </td>
                    <td className="hidden text-right lg:table-cell">{fmtMetric("occupancy", r.m.occupancy)}</td>
                    <td className="hidden text-right md:table-cell">{money(r.m.monthlyRent)}</td>
                    <td className="hidden text-right lg:table-cell">{money(r.m.billed)}</td>
                    <td className="hidden text-right sm:table-cell">{money(r.m.received)}</td>
                    <td className={cn("hidden text-right md:table-cell", r.m.collectionRate != null && r.m.collectionRate < 0.8 && "text-warning")}>{fmtMetric("collectionRate", r.m.collectionRate)}</td>
                    <td className={cn("text-right font-medium", r.m.outstanding > 0 && "text-danger")}>{money(r.m.outstanding)}</td>
                    <td className="hidden text-right lg:table-cell">{r.m.outstanding > 0 ? `${r.m.oldestDays}d` : "—"}</td>
                    <td className="hidden text-right xl:table-cell">{money(r.m.net)}</td>
                    <td className="hidden text-right xl:table-cell">{fmtMetric("yieldPct", r.m.yieldPct)}</td>
                  </tr>
                ))}
                {!sortedRows.length && <tr><td colSpan={10} className="!py-10 text-center text-muted-fg">Nothing matches these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </Widget>
      )}

      <p className="text-[11.5px] text-muted-fg">
        Figures as of {new Date(f.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}. Rent is billed monthly; charges and deposits are shown separately.
      </p>

      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[160] -translate-x-1/2 animate-fade-in rounded-lg bg-fg px-4 py-2.5 text-[12.5px] text-white shadow-token-lg">{toast}</div>}
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function delta(cur: number, prev: number | undefined | null) {
  if (prev == null || prev === 0) return null;
  const d = (cur - prev) / Math.abs(prev);
  return { text: `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`, up: d >= 0 };
}
function ptsDelta(cur: number | null, prev: number | null | undefined, digits = 0) {
  if (cur == null || prev == null) return null;
  const d = (cur - prev) * 100;
  return { text: `${d >= 0 ? "+" : ""}${d.toFixed(digits)} pts`, up: d >= 0 };
}

function KpiCard({
  label, value, hint, delta: dl, spark, tone, info, onClick,
}: {
  label: string; value: string; hint?: string; delta?: { text: string; up: boolean } | null;
  spark?: (number | null)[]; tone?: "success" | "warning" | "danger"; info?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1">
        <span className="kpi-label truncate">{label}</span>
        {info && <span title={info} className="text-disabled"><Info size={11} /></span>}
      </div>
      <div className={cn("mt-1.5 truncate text-[19px] font-medium tracking-[-0.02em] tabular-nums sm:text-[21px]", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-fg")}>{value}</div>
      <div className="mt-0.5 flex min-h-[18px] flex-wrap items-center gap-x-2 text-[11.5px] text-muted-fg">
        {dl && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", dl.up ? "text-success" : "text-danger")}>
            {dl.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{dl.text}
          </span>
        )}
        {hint && <span className="truncate">{hint}</span>}
      </div>
      {spark && spark.some((v) => v) ? <Spark values={spark} className="mt-2" /> : null}
    </>
  );
  const cls = "card flex min-w-0 flex-col !p-3 text-left sm:!p-4";
  return onClick ? <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:border-line-strong")}>{body}</button> : <div className={cls}>{body}</div>;
}

function Widget({ id, title, sub, right, icon, children }: { id?: string; title: string; sub?: string; right?: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-40 p-0">
      <div className="section-head flex-wrap">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5">{icon}{title}</h2>
          {sub && <p className="text-[11.5px] text-muted-fg">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function DimTabs({ dims, dim, onDim }: { dims: Dim[]; dim: Dim; onDim: (d: Dim) => void }) {
  if (dims.length < 2) return null;
  return (
    <div className="segmented" role="tablist">
      {dims.map((d) => (
        <button key={d} type="button" role="tab" aria-selected={dim === d} aria-current={dim === d} onClick={() => onDim(d)}>{DIM_LABEL[d]}</button>
      ))}
    </div>
  );
}

function Th({ label, k, sort, setSort, right, hide }: {
  label: string; k: MetricKey | "label"; sort: { key: MetricKey | "label"; dir: 1 | -1 };
  setSort: (s: { key: MetricKey | "label"; dir: 1 | -1 }) => void; right?: boolean; hide?: "sm" | "md" | "lg" | "xl";
}) {
  const active = sort.key === k;
  const hideCls = hide ? { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" }[hide] : "";
  return (
    <th className={cn("th-sort", right && "text-right", active && "text-fg", hideCls)} onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === "label" ? 1 : -1 })} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}{active && <span className="ml-0.5 text-primary">{sort.dir === 1 ? "↑" : "↓"}</span>}
    </th>
  );
}

function OverdueList({ items, links, onLessee }: { items: ReturnType<typeof overdueItems>; links?: boolean; onLessee: (n: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mt-4 max-h-64 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line-subtle">
      {items.slice(0, 40).map((i, k) => (
        <li key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
          <div className="min-w-0">
            <button type="button" onClick={() => onLessee(i.lessee)} className="block max-w-full truncate text-left font-medium hover:text-primary">{i.lessee}</button>
            <span className="block truncate text-[11.5px] text-muted-fg">{i.property} · due {fmtDate(i.due)}</span>
          </div>
          <div className="shrink-0 text-right">
            <span className="block font-medium tabular-nums text-danger">{money(i.amount)}</span>
            <span className="block text-[11px] text-muted-fg">{i.days}d late{links && <> · <Link className="text-primary hover:underline" href={`/rent/statement?lessee=${encodeURIComponent(i.lessee)}`}>statement</Link></>}</span>
          </div>
        </li>
      ))}
      {items.length > 40 && <li className="px-3 py-2 text-center text-[12px] text-muted-fg">+{items.length - 40} more — narrow the filters or see Rent Collection.</li>}
    </ul>
  );
}

function CustomizeMenu({ widgets, onToggle }: { widgets: Record<WidgetId, boolean>; onToggle: (id: WidgetId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-ghost h-8" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Settings2 size={14} /> <span className="hidden sm:inline">Customize</span></button>
      {open && (
        <div className="popover absolute right-0 z-40 mt-1 w-64 animate-fade-in">
          <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-soft">Show on this dashboard</div>
          {WIDGETS.map((w) => (
            <button key={w.id} type="button" onClick={() => onToggle(w.id)} className="popover-item justify-between">
              {w.label}
              <span className={cn("flex h-4 w-4 items-center justify-center rounded border", widgets[w.id] ? "border-primary bg-primary text-white" : "border-line-strong")}>
                {widgets[w.id] && <Check size={11} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewsMenu({ views, onApply, onSave, onDelete }: { views: { name: string; qs: string }[]; onApply: (v: { qs: string }) => void; onSave: () => void; onDelete: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-ghost h-8" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Bookmark size={14} /> <span className="hidden sm:inline">Views</span></button>
      {open && (
        <div className="popover absolute right-0 z-40 mt-1 w-64 animate-fade-in">
          <button type="button" className="popover-item font-medium text-primary" onClick={() => { setOpen(false); onSave(); }}>+ Save current view</button>
          {views.length > 0 && <div className="my-1 border-t border-line-subtle" />}
          {views.map((v) => (
            <div key={v.name} className="flex items-center">
              <button type="button" className="popover-item min-w-0 flex-1 truncate" onClick={() => { onApply(v); setOpen(false); }}>{v.name}</button>
              <button type="button" className="mr-1 rounded p-1 text-muted-fg hover:bg-muted hover:text-danger" aria-label={`Delete ${v.name}`} onClick={() => onDelete(v.name)}><X size={12} /></button>
            </div>
          ))}
          {!views.length && <p className="px-3 pb-2 pt-1 text-[11.5px] text-muted-fg">Saved views stay in this browser.</p>}
        </div>
      )}
    </div>
  );
}

export type { DimRow };
export { compactNum, Dot };
