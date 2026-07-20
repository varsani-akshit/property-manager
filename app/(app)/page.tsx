import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, periodDays, type Range } from "@/lib/period";
import { StackedBarTrend, DonutChart } from "@/components/Charts";
import { money, fmtDate } from "@/lib/format";
import { guardView } from "@/lib/guard";
import Link from "next/link";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

type Search = { range?: string; from?: string; to?: string };

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

  // ONE round-trip instead of eight — see supabase/023_dashboard_rpc.sql
  const { data: snap } = await sb.rpc("dashboard_snapshot", {
    p_from: period.from,
    p_to: period.to,
  });
  const s: any = snap ?? {};

  const collected: any[] = s.collected ?? [];
  const dueRows: any[] = s.dueInPeriod ?? [];
  const overdueTotals = s.overdueTotals ?? { amount: 0, row_count: 0, distinct_lessees: 0, oldest_days: 0 };
  const lesseeWatchListRaw: any[] = s.overdueByLessee ?? [];
  const costs: any[] = (s.costs ?? []).map((c: any) => ({
    allocated_amount: c.allocated_amount,
    property_id: c.property_id,
    costs: { incurred_on: c.incurred_on, category: c.category },
  }));
  const properties: any[] = (s.properties ?? []).map((p: any) => ({
    ...p,
    compounds: p.compound_id ? { id: p.compound_id, name: p.compound_name } : null,
  }));
  const activeLeases: any[] = s.leases ?? [];
  const upcomingDues: any[] = s.upcoming ?? [];
  const costsWithCat: any[] = s.costsByCategory ?? [];

  // === HEADLINE TOTALS ===
  const collectedTotal = collected.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const dueInPeriodTotal = dueRows.reduce((s, r) => s + Number((r as any).net_amount || 0), 0);
  const outstandingTotal = Number(overdueTotals.amount || 0);
  const costsTotal = costs.reduce((s, r) => s + Number(r.allocated_amount || 0), 0);
  const net = collectedTotal - costsTotal;
  const collectionRate = dueInPeriodTotal > 0 ? (collectedTotal / dueInPeriodTotal) * 100 : null;
  const totalValuation = properties.reduce((s, p) => s + Number(p.valuation || 0), 0);
  const roiPeriodPct = totalValuation > 0 ? (net / totalValuation) * 100 : 0;
  const roiAnnualizedPct = totalValuation > 0 ? roiPeriodPct * (365 / days) : 0;
  const distinctOverdueLessees = Number(overdueTotals.distinct_lessees || 0);
  const worstDaysLate = Number(overdueTotals.oldest_days || 0);

  // Punctuality (period) — merged into the outstanding panel as an on-time% indicator
  const leaseToLessee: Record<string, string> = {};
  for (const l of activeLeases) leaseToLessee[l.id] = l.lessee_name;
  const punctByLessee: Record<string, { payments: number; on_time: number; avg_delay: number }> = {};
  const punctDelays: Record<string, number[]> = {};
  for (const r of collected) {
    if (!r.collected_at || !r.due_date) continue;
    const name = leaseToLessee[(r as any).lease_id] ?? "(other)";
    const delay = Math.round((new Date(r.collected_at as any).getTime() - new Date(r.due_date).getTime()) / 86400000);
    punctDelays[name] ??= [];
    punctDelays[name].push(delay);
  }
  for (const [name, delays] of Object.entries(punctDelays)) {
    const onTime = delays.filter((d) => d <= 0).length;
    punctByLessee[name] = {
      payments: delays.length,
      on_time: (onTime / delays.length) * 100,
      avg_delay: delays.reduce((s, d) => s + d, 0) / delays.length,
    };
  }

  // Watchlist is now pre-aggregated by SQL (top 10 by amount).
  const lesseeWatchList = lesseeWatchListRaw.map((l: any) => ({
    name: l.lessee_name,
    amount: Number(l.amount),
    count: Number(l.count),
    oldest_days: Number(l.oldest_days),
    properties: new Set<string>(l.properties ?? []),
    on_time_pct: punctByLessee[l.lessee_name]?.on_time ?? null,
    payments: punctByLessee[l.lessee_name]?.payments ?? 0,
  }));

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
  const trend = Array.from(monthBuckets.entries()).map(([ym, v]) => ({
    ym, collected: v.collected, costs: v.costs, net: v.collected - v.costs,
  }));

  // === PROPERTY LEADERBOARD ===
  const propIndex = new Map<string, { name: string; valuation: number; compound_name: string }>();
  for (const p of properties) {
    const c = Array.isArray(p.compounds) ? p.compounds[0] : p.compounds;
    propIndex.set(p.id, { name: p.name, valuation: Number(p.valuation || 0), compound_name: c?.name ?? "—" });
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
  const propPerformance = Array.from(propIndex.entries())
    .map(([id, info]) => {
      const pp = perProp[id] ?? { collected: 0, costs: 0 };
      const propNet = pp.collected - pp.costs;
      const roi = info.valuation > 0 ? (propNet / info.valuation) * 100 * (365 / days) : 0;
      return { id, ...info, collected: pp.collected, costs: pp.costs, net: propNet, roi };
    })
    .filter((p) => p.collected > 0 || p.costs > 0); // only properties with activity this period
  const topPerformers = [...propPerformance].sort((a, b) => b.roi - a.roi).slice(0, 5);
  const bottomPerformers = [...propPerformance].sort((a, b) => a.roi - b.roi).slice(0, 5);

  // === CASH FLOW ===
  const next30 = upcomingDues.filter((d) => new Date(d.due_date) <= horizon30).reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const next60 = upcomingDues.filter((d) => new Date(d.due_date) <= horizon60).reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const next90 = upcomingDues.reduce((s, d) => s + Number(d.net_amount || 0), 0);
  const expectedMonthly = activeLeases.reduce((s, l) => s + Number(l.gross_rent_monthly || 0), 0);

  // === COSTS BY CATEGORY (line-item level) ===
  const byCategory: Record<string, number> = {};
  for (const li of costsWithCat) {
    const row = li as { category: string; amount: number };
    byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.amount || 0);
  }
  const categoryRows = Object.entries(byCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const topCategories = categoryRows.slice(0, 8);

  // === OCCUPANCY & EXPIRING ===
  const occupancyPct = properties.length > 0 ? (activeLeases.length / properties.length) * 100 : 0;
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
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/export/outstanding`} className="btn-secondary text-xs"><Download size={12}/> Outstanding</a>
            <a href={`/api/export/collected?${exportQuery}`} className="btn-secondary text-xs"><Download size={12}/> Collected</a>
            <a href={`/api/export/costs?${exportQuery}`} className="btn-secondary text-xs"><Download size={12}/> Costs</a>
          </div>
        }
      />

      <DateFilter active={period.range as Range} />

      {/* HERO — the bottom-line story */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi">
          <div className="kpi-label">Net profit</div>
          <div className={`kpi-value sm:text-xl ${net < 0 ? "text-danger" : "text-success"}`}>{money(net)}</div>
          <div className="text-xs text-muted-fg mt-auto">
            {money(collectedTotal)} in − {money(costsTotal)} out
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Collection rate</div>
          <div className={`kpi-value sm:text-xl ${collectionRate !== null && collectionRate < 80 ? "text-warning" : ""}`}>
            {collectionRate !== null ? `${collectionRate.toFixed(0)}%` : "—"}
          </div>
          <div className="text-xs text-muted-fg mt-auto">
            {money(collectedTotal)} of {money(dueInPeriodTotal)} billed
          </div>
        </div>
        <Link href="/rent" className="kpi hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="kpi-label">Outstanding</div>
          <div className="kpi-value sm:text-xl text-danger">{money(outstandingTotal)}</div>
          <div className="text-xs text-muted-fg mt-auto">
            {distinctOverdueLessees} tenant{distinctOverdueLessees === 1 ? "" : "s"} · oldest {worstDaysLate}d →
          </div>
        </Link>
        <div className="kpi">
          <div className="kpi-label">ROI annualized</div>
          <div className={`kpi-value sm:text-xl ${roiAnnualizedPct < 0 ? "text-danger" : ""}`}>{roiAnnualizedPct.toFixed(2)}%</div>
          <div className="text-xs text-muted-fg mt-auto">
            On {money(totalValuation)} valuation
          </div>
        </div>
      </div>

      {/* MONTHLY TREND + OPERATIONS — merged into one panel */}
      <div className="card p-0 mb-6">
        <div className="section-head">
          <h2>Monthly trend — {period.label}</h2>
          <span className="text-xs text-muted-fg">{trend.length} month{trend.length === 1 ? "" : "s"}</span>
        </div>
        <div className="panel">
          <StackedBarTrend
            data={trend.map((t) => ({ label: t.ym.slice(2), collected: t.collected, costs: t.costs }))}
            formatValue={(n) => money(n)}
          />
        </div>
        <div className="panel grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div className="text-center">
            <div className="text-xs uppercase text-muted-fg">Occupancy</div>
            <div className="font-semibold text-lg">{occupancyPct.toFixed(0)}%</div>
            <div className="text-xs text-muted-fg">{activeLeases.length} of {properties.length}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-fg">Expected / mo</div>
            <div className="font-semibold text-lg">{money(expectedMonthly)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-fg">Next 30 days</div>
            <div className="font-semibold text-lg">{money(next30)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-fg">Next 60 days</div>
            <div className="font-semibold text-lg">{money(next60)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-fg">Next 90 days</div>
            <div className="font-semibold text-lg">{money(next90)}</div>
          </div>
        </div>
      </div>

      {/* WATCH PANEL — single card, two internal sections */}
      <div className="card p-0 mb-6 grid lg:grid-cols-2 lg:divide-x divide-border">
        <div>
          <div className="section-head">
            <h2>Outstanding · who to chase</h2>
            <Link href="/rent" className="text-xs text-primary hover:underline">All rows →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lessee</th>
                  <th className="text-right">Oldest</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">On-time</th>
                </tr>
              </thead>
              <tbody>
                {lesseeWatchList.map((l) => {
                  const otBadge =
                    l.on_time_pct === null ? "badge-muted" :
                    l.on_time_pct >= 90 ? "badge-success" :
                    l.on_time_pct >= 50 ? "badge-warning" : "badge-danger";
                  return (
                    <tr key={l.name}>
                      <td>
                        <Link href={`/rent?lessee=${encodeURIComponent(l.name)}`} className="font-medium hover:underline">{l.name}</Link>
                        <div className="text-xs text-muted-fg truncate max-w-[18rem]">{Array.from(l.properties).join(", ")}</div>
                      </td>
                      <td className={`text-right tabular-nums ${l.oldest_days > 30 ? "text-danger font-medium" : "text-warning"}`}>
                        {l.oldest_days}d
                      </td>
                      <td className="text-right font-medium tabular-nums">{money(l.amount)}</td>
                      <td className="text-right">
                        <span className={otBadge}>
                          {l.on_time_pct === null ? "—" : `${l.on_time_pct.toFixed(0)}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!lesseeWatchList.length && <tr><td colSpan={4} className="text-center text-muted-fg py-6">All caught up.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="section-head">
            <h2>Leases ending soon</h2>
            <span className="text-xs text-muted-fg">Within 60 days</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lessee</th>
                  <th>Property</th>
                  <th>End date</th>
                  <th className="text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {expiringLeases.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">
                      <Link href={`/leases/${l.id}`} className="hover:underline">{l.lessee}</Link>
                    </td>
                    <td className="text-xs text-muted-fg">
                      <Link href={`/properties/${l.property_id}`} className="hover:underline">
                        {propIndex.get(l.property_id)?.name ?? "—"}
                      </Link>
                    </td>
                    <td>{fmtDate(l.end_date)}</td>
                    <td className={`text-right font-medium tabular-nums ${l.days_left <= 14 ? "text-danger" : l.days_left <= 30 ? "text-warning" : ""}`}>
                      {l.days_left}
                    </td>
                  </tr>
                ))}
                {!expiringLeases.length && <tr><td colSpan={4} className="text-center text-muted-fg py-6">No leases ending soon.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PERFORMANCE + COSTS — single card, two internal sections */}
      <div className="card p-0 mb-6 grid lg:grid-cols-2 lg:divide-x divide-border">
        <div>
          <div className="section-head">
            <h2>Property performance</h2>
            <span className="text-xs text-muted-fg">{period.label}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th className="text-right">Net</th>
                  <th className="text-right">ROI</th>
                </tr>
              </thead>
              <tbody>
                {topPerformers.length > 0 && (
                  <tr><td colSpan={3} className="text-[10px] uppercase text-muted-fg bg-muted/30 py-1.5 px-3 tracking-wide">Top performers</td></tr>
                )}
                {topPerformers.map((p) => (
                  <tr key={`top-${p.id}`}>
                    <td>
                      <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted-fg">{p.compound_name}</div>
                    </td>
                    <td className="text-right tabular-nums">{money(p.net)}</td>
                    <td className="text-right tabular-nums text-success font-medium">{p.roi.toFixed(1)}%</td>
                  </tr>
                ))}
                {bottomPerformers.length > 0 && bottomPerformers.some((b) => !topPerformers.find((t) => t.id === b.id)) && (
                  <tr><td colSpan={3} className="text-[10px] uppercase text-muted-fg bg-muted/30 py-1.5 px-3 tracking-wide">Needs attention</td></tr>
                )}
                {bottomPerformers.filter((b) => !topPerformers.find((t) => t.id === b.id)).map((p) => (
                  <tr key={`bot-${p.id}`}>
                    <td>
                      <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted-fg">{p.compound_name}</div>
                    </td>
                    <td className={`text-right tabular-nums ${p.net < 0 ? "text-danger" : ""}`}>{money(p.net)}</td>
                    <td className={`text-right tabular-nums font-medium ${p.roi < 0 ? "text-danger" : "text-warning"}`}>{p.roi.toFixed(1)}%</td>
                  </tr>
                ))}
                {!propPerformance.length && <tr><td colSpan={3} className="text-center text-muted-fg py-6">No activity.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="section-head">
            <h2>Cost breakdown</h2>
            <span className="text-xs text-muted-fg">{money(costsTotal)} total</span>
          </div>
          <div className="panel">
            {topCategories.length > 0 ? (
              <DonutChart data={topCategories} formatValue={(n) => money(n)} />
            ) : (
              <p className="text-sm text-muted-fg py-6 text-center">No costs in this period.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
