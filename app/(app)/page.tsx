import { supabaseServer } from "@/lib/supabase/server";
import { Kpi } from "@/components/Kpi";
import { PageHeader } from "@/components/PageHeader";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { Sparkline, BarChart, StackedBarTrend, DonutChart } from "@/components/Charts";
import { money, fmtDate } from "@/lib/format";
import { guardView } from "@/lib/guard";
import Link from "next/link";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

type Search = { range?: string; from?: string; to?: string };

const palette = {
  success: "hsl(142 71% 45%)",
  warning: "hsl(38 92% 50%)",
  danger:  "hsl(0 72% 51%)",
  accent:  "hsl(221 83% 53%)",
};

function ymKey(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function listMonths(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const a = new Date(fromISO + "T00:00:00Z");
  const b = new Date(toISO + "T00:00:00Z");
  let y = a.getUTCFullYear(), m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  await guardView("view_dashboard");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const days = periodDays(period);
  const today = new Date().toISOString().slice(0, 10);
  const horizon30 = new Date(); horizon30.setDate(horizon30.getDate() + 30);
  const horizon60 = new Date(); horizon60.setDate(horizon60.getDate() + 60);
  const horizon90 = new Date(); horizon90.setDate(horizon90.getDate() + 90);

  const sb = await supabaseServer();

  const [
    collectedRes, dueInPeriodRes, overdueRes, costsRes, propsRes, leasesRes,
    upcomingDuesRes, costsWithCatRes,
  ] = await Promise.all([
    sb.from("rent_collections")
      .select("net_amount, collected_at, due_date, property_id, lease_id")
      .eq("status", "collected")
      .gte("collected_at", `${period.from}T00:00:00Z`)
      .lte("collected_at", `${period.to}T23:59:59Z`),
    sb.from("rent_collections")
      .select("net_amount, due_date, status, property_id, lease_id")
      .gte("due_date", period.from)
      .lte("due_date", period.to),
    sb.from("rent_collections")
      .select("id, net_amount, due_date, property_id, lease_id, properties(name, compound_id), leases(id, lessee_name)")
      .eq("status", "due")
      .lte("due_date", today)
      .order("due_date", { ascending: true }),
    sb.from("cost_allocations")
      .select("allocated_amount, property_id, costs!inner(incurred_on, category, payable_by_lessee)")
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to)
      .eq("costs.payable_by_lessee", false),
    sb.from("properties").select("id, name, valuation, compound_id, compounds(id, name)").eq("archived", false),
    sb.from("leases").select("id, lessee_name, property_id, gross_rent_monthly, end_date, active, start_date").eq("active", true),
    // Upcoming dues (next 90 days) — for cash flow projection
    sb.from("rent_collections")
      .select("net_amount, due_date")
      .eq("status", "due")
      .gt("due_date", today)
      .lte("due_date", horizon90.toISOString().slice(0, 10)),
    // Costs by category in period — query line items so multi-category costs
    // contribute to every category they include.
    sb.from("cost_line_items")
      .select("category, amount, costs!inner(incurred_on, payable_by_lessee)")
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to)
      .eq("costs.payable_by_lessee", false),
  ]);

  const collected = collectedRes.data ?? [];
  const dueRows = dueInPeriodRes.data ?? [];
  const overdue = (overdueRes.data ?? []) as any[];
  const costs = (costsRes.data ?? []) as any[];
  const properties = (propsRes.data ?? []) as any[];
  const activeLeases = (leasesRes.data ?? []) as any[];
  const upcomingDues = (upcomingDuesRes.data ?? []) as any[];
  const costsWithCat = (costsWithCatRes.data ?? []) as any[];

  // === TOP-LEVEL TOTALS ===
  const collectedTotal = collected.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const dueInPeriodTotal = dueRows.reduce((s, r) => s + Number((r as any).net_amount || 0), 0);
  const outstandingTotal = overdue.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const costsTotal = costs.reduce((s, r) => s + Number(r.allocated_amount || 0), 0);
  const net = collectedTotal - costsTotal;
  const collectionRate = dueInPeriodTotal > 0 ? (collectedTotal / dueInPeriodTotal) * 100 : null;
  const totalValuation = properties.reduce((s, p) => s + Number(p.valuation || 0), 0);

  // === ROI ===
  const roiPeriodPct = totalValuation > 0 ? (net / totalValuation) * 100 : 0;
  const roiAnnualizedPct = totalValuation > 0 ? roiPeriodPct * (365 / days) : 0;

  // === PER-PROPERTY ROI ===
  const propIndex = new Map<string, { name: string; valuation: number; compound_id: string; compound_name: string }>();
  for (const p of properties) {
    const c = Array.isArray(p.compounds) ? p.compounds[0] : p.compounds;
    propIndex.set(p.id, { name: p.name, valuation: Number(p.valuation || 0), compound_id: p.compound_id, compound_name: c?.name ?? "—" });
  }
  const perProp: Record<string, { collected: number; costs: number }> = {};
  for (const r of collected) {
    const k = (r as any).property_id;
    perProp[k] ??= { collected: 0, costs: 0 };
    perProp[k].collected += Number(r.net_amount || 0);
  }
  for (const c of costs) {
    const k = c.property_id;
    perProp[k] ??= { collected: 0, costs: 0 };
    perProp[k].costs += Number(c.allocated_amount || 0);
  }
  const propROIs = Array.from(propIndex.entries()).map(([id, info]) => {
    const pp = perProp[id] ?? { collected: 0, costs: 0 };
    const propNet = pp.collected - pp.costs;
    const roi = info.valuation > 0 ? (propNet / info.valuation) * 100 : 0;
    return { id, ...info, collected: pp.collected, costs: pp.costs, net: propNet, roi };
  });
  const topPropROI = [...propROIs].sort((a, b) => b.roi - a.roi).slice(0, 5);
  const bottomPropROI = [...propROIs].sort((a, b) => a.roi - b.roi).slice(0, 5);
  const topPropCosts = [...propROIs].sort((a, b) => b.costs - a.costs).slice(0, 5);

  // === PER-COMPOUND ===
  const perCompound: Record<string, { name: string; valuation: number; collected: number; costs: number }> = {};
  for (const p of propROIs) {
    perCompound[p.compound_id] ??= { name: p.compound_name, valuation: 0, collected: 0, costs: 0 };
    perCompound[p.compound_id].valuation += p.valuation;
    perCompound[p.compound_id].collected += p.collected;
    perCompound[p.compound_id].costs += p.costs;
  }
  const compoundROIs = Object.entries(perCompound).map(([id, c]) => {
    const cnet = c.collected - c.costs;
    return { id, ...c, net: cnet, roi: c.valuation > 0 ? (cnet / c.valuation) * 100 : 0 };
  });
  const topCompoundROI = [...compoundROIs].sort((a, b) => b.roi - a.roi).slice(0, 5);

  // === OUTSTANDING BY LESSEE ===
  type LesseeRow = { name: string; lease_id: string | null; amount: number; count: number; properties: Set<string>; oldest_days: number };
  const byLessee: Record<string, LesseeRow> = {};
  for (const r of overdue) {
    const l = Array.isArray(r.leases) ? r.leases[0] : r.leases;
    const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    const name = l?.lessee_name ?? "(unknown)";
    const daysLate = Math.max(0, Math.round((Date.now() - new Date(r.due_date).getTime()) / 86400000));
    byLessee[name] ??= { name, lease_id: l?.id ?? null, amount: 0, count: 0, properties: new Set(), oldest_days: 0 };
    byLessee[name].amount += Number(r.net_amount || 0);
    byLessee[name].count += 1;
    if (p?.name) byLessee[name].properties.add(p.name);
    if (daysLate > byLessee[name].oldest_days) byLessee[name].oldest_days = daysLate;
  }
  const topLesseesOutstanding = Object.values(byLessee).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // === OUTSTANDING BY PROPERTY ===
  const byProperty: Record<string, { id: string; name: string; amount: number; count: number; oldest_days: number }> = {};
  for (const r of overdue) {
    const id = r.property_id;
    const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    const daysLate = Math.max(0, Math.round((Date.now() - new Date(r.due_date).getTime()) / 86400000));
    byProperty[id] ??= { id, name: p?.name ?? "—", amount: 0, count: 0, oldest_days: 0 };
    byProperty[id].amount += Number(r.net_amount || 0);
    byProperty[id].count += 1;
    if (daysLate > byProperty[id].oldest_days) byProperty[id].oldest_days = daysLate;
  }
  const topPropertiesOutstanding = Object.values(byProperty).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // === MONTHLY TREND ===
  const months = listMonths(period.from, period.to);
  const monthBuckets = new Map<string, { collected: number; costs: number }>();
  for (const m of months) monthBuckets.set(m, { collected: 0, costs: 0 });
  for (const r of collected) {
    if (r.collected_at) {
      const k = ymKey(r.collected_at as any);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.collected += Number(r.net_amount || 0);
    }
  }
  for (const c of costs) {
    const incurred = c.costs?.incurred_on;
    if (incurred) {
      const k = ymKey(incurred);
      if (monthBuckets.has(k)) monthBuckets.get(k)!.costs += Number(c.allocated_amount || 0);
    }
  }
  const trend = Array.from(monthBuckets.entries()).map(([ym, v]) => {
    const m = v.collected - v.costs;
    return { ym, collected: v.collected, costs: v.costs, net: m, roiPct: totalValuation > 0 ? (m / totalValuation) * 100 : 0 };
  });
  const avgMonthlyROI = trend.length ? trend.reduce((s, t) => s + t.roiPct, 0) / trend.length : 0;

  // Sparkline series
  const sparkCollected = trend.map((t) => t.collected);
  const sparkCosts = trend.map((t) => t.costs);
  const sparkNet = trend.map((t) => t.net);

  // === CASH-FLOW PROJECTION (next 30/60/90 days) ===
  const next30 = upcomingDues.filter((d) => new Date(d.due_date) <= horizon30).reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const next60 = upcomingDues.filter((d) => new Date(d.due_date) <= horizon60).reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const next90 = upcomingDues.reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const expectedMonthly = activeLeases.reduce((s, l) => s + Number(l.gross_rent_monthly || 0), 0);

  // === COSTS BY CATEGORY (period) — sums each line item by its own category ===
  const byCategory: Record<string, number> = {};
  for (const li of costsWithCat) {
    const row = li as { category: string; amount: number };
    byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.amount || 0);
  }
  const categoryRows = Object.entries(byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // === PAYMENT PUNCTUALITY (per lessee, period) ===
  type PunctRow = { name: string; payments: number; avg_delay_days: number; on_time_pct: number };
  const byLesseePunct: Record<string, { delays: number[]; lease_id: string | null }> = {};
  const leaseToLessee: Record<string, string> = {};
  for (const l of activeLeases) leaseToLessee[l.id] = l.lessee_name;
  for (const r of collected) {
    if (!r.collected_at || !r.due_date) continue;
    const lessee = leaseToLessee[(r as any).lease_id] ?? "(other)";
    const delay = Math.round((new Date(r.collected_at as any).getTime() - new Date(r.due_date).getTime()) / 86400000);
    byLesseePunct[lessee] ??= { delays: [], lease_id: (r as any).lease_id };
    byLesseePunct[lessee].delays.push(delay);
  }
  const punctualityRows: PunctRow[] = Object.entries(byLesseePunct).map(([name, v]) => {
    const avg = v.delays.reduce((s, d) => s + d, 0) / v.delays.length;
    const onTime = v.delays.filter((d) => d <= 0).length;
    return { name, payments: v.delays.length, avg_delay_days: avg, on_time_pct: (onTime / v.delays.length) * 100 };
  }).sort((a, b) => b.payments - a.payments).slice(0, 10);

  // === OCCUPANCY ===
  const occupiedCount = activeLeases.length;
  const occupancyPct = properties.length > 0 ? (occupiedCount / properties.length) * 100 : 0;

  // === EXPIRING LEASES ===
  const now = Date.now();
  const expiringLeases = activeLeases
    .map((l) => {
      const daysLeft = Math.round((new Date(l.end_date).getTime() - now) / 86400000);
      return { id: l.id, lessee: l.lessee_name, end_date: l.end_date, days_left: daysLeft, property_id: l.property_id };
    })
    .filter((l) => l.days_left >= 0 && l.days_left <= 60)
    .sort((a, b) => a.days_left - b.days_left);

  const exportQuery = (() => {
    const params = new URLSearchParams();
    params.set("range", period.range);
    if (period.range === "custom") { params.set("from", period.from); params.set("to", period.to); }
    return params.toString();
  })();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Comprehensive rental report — ${period.label}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/export/outstanding`} className="btn-secondary text-xs"><Download size={12}/> Outstanding</a>
            <a href={`/api/export/collected?${exportQuery}`} className="btn-secondary text-xs"><Download size={12}/> Collected</a>
            <a href={`/api/export/costs?${exportQuery}`} className="btn-secondary text-xs"><Download size={12}/> Costs</a>
            <a href={`/api/export/properties`} className="btn-secondary text-xs"><Download size={12}/> Properties</a>
          </div>
        }
      />

      <DateFilter active={period.range as Range} />

      {/* COLLECTION HEALTH */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi">
          <div className="kpi-label">Rent collected (period)</div>
          <div className="kpi-value">{money(collectedTotal)}</div>
          <div className="text-success"><Sparkline data={sparkCollected} color={palette.success} /></div>
          <div className="text-xs text-muted-fg">{collected.length} payment{collected.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rent due in period</div>
          <div className="kpi-value">{money(dueInPeriodTotal)}</div>
          <div className="text-xs text-muted-fg mt-auto">{dueRows.length} row{dueRows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Collection rate</div>
          <div className="kpi-value">{collectionRate !== null ? `${collectionRate.toFixed(1)}%` : "—"}</div>
          <div className="text-xs text-muted-fg mt-auto">Collected ÷ Due (period)</div>
        </div>
        <Link href="/rent" className="kpi hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="kpi-label">Outstanding (all-time)</div>
          <div className="kpi-value text-danger">{money(outstandingTotal)}</div>
          <div className="text-xs text-muted-fg mt-auto">{overdue.length} overdue row{overdue.length === 1 ? "" : "s"} →</div>
        </Link>
      </div>

      {/* PROFITABILITY */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi">
          <div className="kpi-label">Total costs (period)</div>
          <div className="kpi-value">{money(costsTotal)}</div>
          <div className="text-danger"><Sparkline data={sparkCosts} color={palette.danger} /></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Net (collected − costs)</div>
          <div className={`kpi-value ${net < 0 ? "text-danger" : "text-success"}`}>{money(net)}</div>
          <div className={net < 0 ? "text-danger" : "text-success"}><Sparkline data={sparkNet} color={net < 0 ? palette.danger : palette.success} /></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ROI {days}d</div>
          <div className={`kpi-value ${roiPeriodPct < 0 ? "text-danger" : ""}`}>{roiPeriodPct.toFixed(2)}%</div>
          <div className="text-xs text-muted-fg mt-auto">net ÷ valuation</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ROI annualized</div>
          <div className={`kpi-value ${roiAnnualizedPct < 0 ? "text-danger" : ""}`}>{roiAnnualizedPct.toFixed(2)}%</div>
          <div className="text-xs text-muted-fg mt-auto">From {days}d period</div>
        </div>
      </div>

      {/* OPERATIONAL */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Active leases" value={String(occupiedCount)} hint={`${occupancyPct.toFixed(0)}% occupancy`} />
        <Kpi label="Expected rent / mo" value={money(expectedMonthly)} />
        <Kpi label="Avg monthly ROI" value={`${avgMonthlyROI.toFixed(2)}%`} hint={`${trend.length} month${trend.length === 1 ? "" : "s"}`} />
        <Kpi label="Leases expiring ≤60d" value={String(expiringLeases.length)} />
      </div>

      {/* CASH FLOW PROJECTION */}
      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Cash-flow projection (upcoming dues)</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs uppercase text-muted-fg">Next 30 days</div>
            <div className="text-lg font-semibold">{money(next30)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-fg">Next 60 days</div>
            <div className="text-lg font-semibold">{money(next60)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-fg">Next 90 days</div>
            <div className="text-lg font-semibold">{money(next90)}</div>
          </div>
        </div>
      </div>

      {/* MONTHLY TREND CHART */}
      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Monthly trend — collected vs costs ({period.label})</h2>
        <StackedBarTrend
          data={trend.map((t) => ({ label: t.ym.slice(2), collected: t.collected, costs: t.costs }))}
          formatValue={(n) => money(n)}
        />
      </div>

      {/* MONTHLY TREND TABLE */}
      <div className="card p-0 mb-6">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Monthly breakdown</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Collected</th>
                <th className="text-right">Costs</th>
                <th className="text-right">Net</th>
                <th className="text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.ym}>
                  <td className="font-medium">{t.ym}</td>
                  <td className="text-right">{money(t.collected)}</td>
                  <td className="text-right text-muted-fg">{money(t.costs)}</td>
                  <td className={`text-right font-medium ${t.net < 0 ? "text-danger" : ""}`}>{money(t.net)}</td>
                  <td className={`text-right ${t.roiPct < 0 ? "text-danger" : ""}`}>{t.roiPct.toFixed(2)}%</td>
                </tr>
              ))}
              {!trend.length && <tr><td colSpan={5} className="text-center text-muted-fg py-6">No data in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOP PERFORMERS */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border"><h2 className="font-semibold">Highest ROI properties</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Property</th><th>Compound</th><th className="text-right">Net</th><th className="text-right">ROI</th></tr></thead>
              <tbody>
                {topPropROI.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td className="text-xs text-muted-fg">{p.compound_name}</td>
                    <td className="text-right">{money(p.net)}</td>
                    <td className="text-right font-medium">{p.roi.toFixed(2)}%</td>
                  </tr>
                ))}
                {!topPropROI.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border"><h2 className="font-semibold">Lowest ROI properties (under-performers)</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Property</th><th>Compound</th><th className="text-right">Net</th><th className="text-right">ROI</th></tr></thead>
              <tbody>
                {bottomPropROI.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td className="text-xs text-muted-fg">{p.compound_name}</td>
                    <td className={`text-right ${p.net < 0 ? "text-danger" : ""}`}>{money(p.net)}</td>
                    <td className={`text-right font-medium ${p.roi < 0 ? "text-danger" : ""}`}>{p.roi.toFixed(2)}%</td>
                  </tr>
                ))}
                {!bottomPropROI.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border"><h2 className="font-semibold">Highest ROI compounds</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Compound</th><th className="text-right">Collected</th><th className="text-right">Costs</th><th className="text-right">ROI</th></tr></thead>
              <tbody>
                {topCompoundROI.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/compounds/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                    <td className="text-right">{money(c.collected)}</td>
                    <td className="text-right text-muted-fg">{money(c.costs)}</td>
                    <td className="text-right font-medium">{c.roi.toFixed(2)}%</td>
                  </tr>
                ))}
                {!topCompoundROI.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border"><h2 className="font-semibold">Costliest properties (period)</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Property</th><th>Compound</th><th className="text-right">Costs</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {topPropCosts.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td className="text-xs text-muted-fg">{p.compound_name}</td>
                    <td className="text-right">{money(p.costs)}</td>
                    <td className={`text-right ${p.net < 0 ? "text-danger" : ""}`}>{money(p.net)}</td>
                  </tr>
                ))}
                {!topPropCosts.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* COSTS BY CATEGORY */}
      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Costs by category ({period.label})</h2>
        <DonutChart data={categoryRows} formatValue={(n) => money(n)} />
      </div>

      {/* OUTSTANDING BREAKDOWN — DRILL-DOWN */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Outstanding by lessee</h2>
            <Link href="/rent" className="text-xs text-accent hover:underline">All rows →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Lessee</th><th>Properties</th><th className="text-right">Months</th><th className="text-right">Oldest</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {topLesseesOutstanding.map((l) => (
                  <tr key={l.name}>
                    <td>
                      <Link href={`/rent?lessee=${encodeURIComponent(l.name)}`} className="font-medium hover:underline">{l.name}</Link>
                    </td>
                    <td className="text-xs text-muted-fg">{Array.from(l.properties).join(", ") || "—"}</td>
                    <td className="text-right">{l.count}</td>
                    <td className="text-right text-danger">{l.oldest_days}d</td>
                    <td className="text-right font-medium">{money(l.amount)}</td>
                  </tr>
                ))}
                {!topLesseesOutstanding.length && <tr><td colSpan={5} className="text-center text-muted-fg py-4">All caught up. 👌</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border"><h2 className="font-semibold">Outstanding by property</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Property</th><th className="text-right">Months</th><th className="text-right">Oldest</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {topPropertiesOutstanding.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/rent?property=${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    </td>
                    <td className="text-right">{p.count}</td>
                    <td className="text-right text-danger">{p.oldest_days}d</td>
                    <td className="text-right font-medium">{money(p.amount)}</td>
                  </tr>
                ))}
                {!topPropertiesOutstanding.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">All caught up.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* TENANT PAYMENT PUNCTUALITY */}
      <div className="card p-0 mb-6">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Tenant payment punctuality (period)</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Lessee</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Avg delay (days)</th>
                <th className="text-right">On-time %</th>
              </tr>
            </thead>
            <tbody>
              {punctualityRows.map((r) => {
                const onTimeBadge =
                  r.on_time_pct >= 90 ? "badge-success" :
                  r.on_time_pct >= 50 ? "badge-warning" : "badge-danger";
                return (
                  <tr key={r.name}>
                    <td>
                      <Link href={`/rent?lessee=${encodeURIComponent(r.name)}`} className="font-medium hover:underline">{r.name}</Link>
                    </td>
                    <td className="text-right">{r.payments}</td>
                    <td className={`text-right ${r.avg_delay_days > 7 ? "text-danger" : r.avg_delay_days < 0 ? "text-success" : ""}`}>
                      {r.avg_delay_days >= 0 ? `+${r.avg_delay_days.toFixed(1)}` : r.avg_delay_days.toFixed(1)}
                    </td>
                    <td className="text-right"><span className={onTimeBadge}>{r.on_time_pct.toFixed(0)}%</span></td>
                  </tr>
                );
              })}
              {!punctualityRows.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No collected payments in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* EXPIRING LEASES */}
      <div className="card p-0">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Leases expiring within 60 days</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Lessee</th><th>Property</th><th>End date</th><th className="text-right">Days left</th></tr></thead>
            <tbody>
              {expiringLeases.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.lessee}</td>
                  <td><Link href={`/properties/${l.property_id}`} className="hover:underline">{propIndex.get(l.property_id)?.name ?? "—"}</Link></td>
                  <td>{fmtDate(l.end_date)}</td>
                  <td className={`text-right font-medium ${l.days_left <= 14 ? "text-danger" : l.days_left <= 30 ? "text-warning" : ""}`}>{l.days_left}</td>
                </tr>
              ))}
              {!expiringLeases.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No leases ending soon.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
