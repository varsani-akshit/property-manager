import { supabaseServer } from "@/lib/supabase/server";
import { Kpi } from "@/components/Kpi";
import { PageHeader } from "@/components/PageHeader";
import { DateFilter, resolvePeriod, periodDays, type Range } from "@/components/DateFilter";
import { money, fmtDate } from "@/lib/format";
import { guardView } from "@/lib/guard";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Search = { range?: string; from?: string; to?: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  await guardView("view_dashboard");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const days = periodDays(period);
  const today = new Date().toISOString().slice(0, 10);

  const sb = await supabaseServer();

  // Pull everything we need in parallel.
  const [
    collectedRes,      // rent collected within period (status='collected' AND collected_at in [from,to])
    dueInPeriodRes,    // rent that BECAME due within period (due_date in [from,to])
    overdueRes,        // currently outstanding (due_date <= today AND status='due') — all-time, not period-bound
    costsRes,          // costs incurred within period (with property allocation)
    propsRes,          // active properties with compound
    leasesRes,         // active leases (for occupancy / lessee mapping)
  ] = await Promise.all([
    sb.from("rent_collections")
      .select("net_amount, collected_at, property_id, lease_id")
      .eq("status", "collected")
      .gte("collected_at", `${period.from}T00:00:00Z`)
      .lte("collected_at", `${period.to}T23:59:59Z`),
    sb.from("rent_collections")
      .select("net_amount, due_date, status, property_id, lease_id, properties(name, compound_id), leases(lessee_name)")
      .gte("due_date", period.from)
      .lte("due_date", period.to),
    sb.from("rent_collections")
      .select("net_amount, due_date, property_id, lease_id, properties(name, compound_id), leases(lessee_name)")
      .eq("status", "due")
      .lte("due_date", today)
      .order("due_date", { ascending: true }),
    sb.from("cost_allocations")
      .select("allocated_amount, property_id, costs!inner(incurred_on)")
      .gte("costs.incurred_on", period.from)
      .lte("costs.incurred_on", period.to),
    sb.from("properties").select("id, name, valuation, compound_id, compounds(id, name)").eq("archived", false),
    sb.from("leases").select("id, lessee_name, property_id, gross_rent_monthly, end_date, active").eq("active", true),
  ]);

  const collected = collectedRes.data ?? [];
  const dueRows = dueInPeriodRes.data ?? [];
  const overdue = overdueRes.data ?? [];
  const costs = costsRes.data ?? [];
  const properties = propsRes.data ?? [];
  const activeLeases = leasesRes.data ?? [];

  // === TOP-LEVEL TOTALS ===
  const collectedTotal = collected.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const dueInPeriodTotal = dueRows.reduce((s: number, r) => s + Number((r as any).net_amount || 0), 0);
  const outstandingTotal = overdue.reduce((s: number, r) => s + Number((r as any).net_amount || 0), 0);
  const costsTotal = costs.reduce((s: number, r) => s + Number((r as any).allocated_amount || 0), 0);
  const net = collectedTotal - costsTotal;
  const collectionRate = dueInPeriodTotal > 0 ? (collectedTotal / dueInPeriodTotal) * 100 : null;
  const totalValuation = properties.reduce((s, p) => s + Number((p as any).valuation || 0), 0);

  // === ROI ===
  // Period ROI = net / valuation. Annualized = period ROI * (365 / days).
  const roiPeriodPct = totalValuation > 0 ? (net / totalValuation) * 100 : 0;
  const roiAnnualizedPct = totalValuation > 0 ? roiPeriodPct * (365 / days) : 0;

  // === PER-PROPERTY ROI (period) ===
  const propIndex = new Map<string, { name: string; valuation: number; compound_id: string; compound_name: string }>();
  for (const p of properties) {
    const c = Array.isArray((p as any).compounds) ? (p as any).compounds[0] : (p as any).compounds;
    propIndex.set((p as any).id, {
      name: (p as any).name,
      valuation: Number((p as any).valuation || 0),
      compound_id: (p as any).compound_id,
      compound_name: c?.name ?? "—",
    });
  }
  const perProp: Record<string, { collected: number; costs: number }> = {};
  for (const r of collected) {
    const k = (r as any).property_id;
    perProp[k] ??= { collected: 0, costs: 0 };
    perProp[k].collected += Number(r.net_amount || 0);
  }
  for (const c of costs) {
    const k = (c as any).property_id;
    perProp[k] ??= { collected: 0, costs: 0 };
    perProp[k].costs += Number((c as any).allocated_amount || 0);
  }
  const propROIs = Array.from(propIndex.entries()).map(([id, info]) => {
    const pp = perProp[id] ?? { collected: 0, costs: 0 };
    const propNet = pp.collected - pp.costs;
    const roi = info.valuation > 0 ? (propNet / info.valuation) * 100 : 0;
    return { id, ...info, collected: pp.collected, costs: pp.costs, net: propNet, roi };
  });
  const topPropROI = [...propROIs].sort((a, b) => b.roi - a.roi).slice(0, 5);

  // === PER-COMPOUND ROI ===
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

  // === OUTSTANDING BY LESSEE (all-time, current) ===
  const byLessee: Record<string, { amount: number; count: number; properties: Set<string> }> = {};
  for (const r of overdue) {
    const l = Array.isArray((r as any).leases) ? (r as any).leases[0] : (r as any).leases;
    const p = Array.isArray((r as any).properties) ? (r as any).properties[0] : (r as any).properties;
    const name = l?.lessee_name ?? "(unknown)";
    byLessee[name] ??= { amount: 0, count: 0, properties: new Set() };
    byLessee[name].amount += Number((r as any).net_amount || 0);
    byLessee[name].count += 1;
    if (p?.name) byLessee[name].properties.add(p.name);
  }
  const topLesseesOutstanding = Object.entries(byLessee)
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count, properties: Array.from(v.properties) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // === OUTSTANDING BY PROPERTY ===
  const byProperty: Record<string, { name: string; amount: number; count: number }> = {};
  for (const r of overdue) {
    const id = (r as any).property_id;
    const p = Array.isArray((r as any).properties) ? (r as any).properties[0] : (r as any).properties;
    byProperty[id] ??= { name: p?.name ?? "—", amount: 0, count: 0 };
    byProperty[id].amount += Number((r as any).net_amount || 0);
    byProperty[id].count += 1;
  }
  const topPropertiesOutstanding = Object.entries(byProperty)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // === MONTHLY TREND (within the period) ===
  // Bucket collected, costs into year-month strings; compute ROI per month.
  type Bucket = { collected: number; costs: number };
  const months = new Map<string, Bucket>();
  const addMonth = (iso: string, field: "collected" | "costs", v: number) => {
    const ym = iso.slice(0, 7); // YYYY-MM
    if (!months.has(ym)) months.set(ym, { collected: 0, costs: 0 });
    months.get(ym)![field] += v;
  };
  for (const r of collected) {
    if ((r as any).collected_at) addMonth(String((r as any).collected_at).slice(0, 10), "collected", Number(r.net_amount || 0));
  }
  for (const c of costs) {
    const incurred = ((c as any).costs?.incurred_on) ?? null;
    if (incurred) addMonth(incurred, "costs", Number((c as any).allocated_amount || 0));
  }
  const trend = Array.from(months.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => {
      const m = v.collected - v.costs;
      return { ym, collected: v.collected, costs: v.costs, net: m, roiPct: totalValuation > 0 ? (m / totalValuation) * 100 : 0 };
    });
  const avgMonthlyROI = trend.length ? trend.reduce((s, t) => s + t.roiPct, 0) / trend.length : 0;

  // === OCCUPANCY ===
  const occupiedCount = activeLeases.length;
  const occupancyPct = properties.length > 0 ? (occupiedCount / properties.length) * 100 : 0;
  const expectedMonthly = activeLeases.reduce((s, l) => s + Number((l as any).gross_rent_monthly || 0), 0);

  // === LEASES EXPIRING ≤ 60 DAYS ===
  const now = Date.now();
  const expiringLeases = activeLeases
    .map((l) => {
      const dl = (l as any).end_date as string;
      const daysLeft = Math.round((new Date(dl).getTime() - now) / 86400000);
      return { id: (l as any).id, lessee: (l as any).lessee_name, end_date: dl, days_left: daysLeft, property_id: (l as any).property_id };
    })
    .filter((l) => l.days_left >= 0 && l.days_left <= 60)
    .sort((a, b) => a.days_left - b.days_left);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Comprehensive rental report — ${period.label}`}
      />

      <DateFilter active={period.range as Range} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected (period)" value={money(collectedTotal)} hint={`${collected.length} payment${collected.length === 1 ? "" : "s"}`} />
        <Kpi label="Rent due in period" value={money(dueInPeriodTotal)} hint={`${dueRows.length} row${dueRows.length === 1 ? "" : "s"}`} />
        <Kpi label="Collection rate" value={collectionRate !== null ? `${collectionRate.toFixed(1)}%` : "—"} hint="Collected / Due (period)" />
        <Kpi label="Outstanding (all-time)" value={money(outstandingTotal)} hint={`${overdue.length} overdue row${overdue.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Total costs (period)" value={money(costsTotal)} />
        <Kpi label="Net (collected − costs)" value={money(net)} hint={net >= 0 ? "Profit" : "Loss"} />
        <Kpi label={`ROI ${days}d`} value={`${roiPeriodPct.toFixed(2)}%`} hint="net / valuation" />
        <Kpi label="ROI annualized" value={`${roiAnnualizedPct.toFixed(2)}%`} hint={`From ${days}d period`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Active leases" value={String(occupiedCount)} hint={`${occupancyPct.toFixed(0)}% occupancy`} />
        <Kpi label="Expected rent / mo" value={money(expectedMonthly)} />
        <Kpi label="Avg monthly ROI (period)" value={`${avgMonthlyROI.toFixed(2)}%`} hint={`${trend.length} month${trend.length === 1 ? "" : "s"} of data`} />
        <Kpi label="Leases expiring ≤60d" value={String(expiringLeases.length)} />
      </div>

      {/* TOP PERFORMERS */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Highest ROI properties ({period.label})</h2>
          </div>
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
                {!topPropROI.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data in period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Highest ROI compounds ({period.label})</h2>
          </div>
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
                {!topCompoundROI.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">No data in period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* OUTSTANDING BREAKDOWN */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Outstanding by lessee</h2>
            <Link href="/rent" className="text-xs text-accent hover:underline">All rows →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Lessee</th><th>Properties</th><th className="text-right">Months</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {topLesseesOutstanding.map((l) => (
                  <tr key={l.name}>
                    <td className="font-medium">{l.name}</td>
                    <td className="text-xs text-muted-fg">{l.properties.join(", ") || "—"}</td>
                    <td className="text-right">{l.count}</td>
                    <td className="text-right font-medium">{money(l.amount)}</td>
                  </tr>
                ))}
                {!topLesseesOutstanding.length && <tr><td colSpan={4} className="text-center text-muted-fg py-4">All caught up. 👌</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-0">
          <div className="px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Outstanding by property</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Property</th><th className="text-right">Months</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {topPropertiesOutstanding.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                    <td className="text-right">{p.count}</td>
                    <td className="text-right font-medium">{money(p.amount)}</td>
                  </tr>
                ))}
                {!topPropertiesOutstanding.length && <tr><td colSpan={3} className="text-center text-muted-fg py-4">All caught up.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MONTHLY TREND */}
      <div className="card p-0 mb-6">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Monthly trend ({period.label})</h2>
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
                  <td className="text-right">{t.roiPct.toFixed(2)}%</td>
                </tr>
              ))}
              {!trend.length && <tr><td colSpan={5} className="text-center text-muted-fg py-6">No collections or costs in this period.</td></tr>}
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
                  <td className="text-right font-medium">{l.days_left}</td>
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
