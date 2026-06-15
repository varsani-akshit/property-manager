import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, type Range } from "@/lib/period";
import { DonutChart } from "@/components/Charts";
import { SearchBar } from "@/components/SearchBar";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import { Plus, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; q?: string }>;
}) {
  const profile = await guardView("view_costs");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const q = sp.q?.trim() || "";

  const sb = await supabaseServer();

  // All line items in the period (optionally filtered by category search)
  let liQ = sb.from("cost_line_items")
    .select("category, amount, cost_id, costs!inner(incurred_on, description, payable_by_lessee)")
    .gte("costs.incurred_on", period.from)
    .lte("costs.incurred_on", period.to)
    .eq("costs.payable_by_lessee", false);
  if (q) liQ = liQ.ilike("category", `%${q}%`);
  const { data: lineItems } = await liQ;
  const lis = (lineItems ?? []) as any[];

  // Aggregate by category
  const byCategory: Record<string, { total: number; costIds: Set<string>; lineCount: number }> = {};
  for (const li of lis) {
    const cat = li.category as string;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, costIds: new Set(), lineCount: 0 };
    byCategory[cat].total += Number(li.amount || 0);
    byCategory[cat].costIds.add(li.cost_id);
    byCategory[cat].lineCount += 1;
  }
  const categories = Object.entries(byCategory)
    .map(([name, v]) => ({ name, total: v.total, costCount: v.costIds.size, lineCount: v.lineCount }))
    .sort((a, b) => b.total - a.total);

  const grandTotal = categories.reduce((s, c) => s + c.total, 0);

  // Recent entries (for context at the bottom)
  const { data: recent } = await sb
    .from("costs")
    .select("id, description, amount, incurred_on, cost_line_items(category)")
    .eq("payable_by_lessee", false)
    .gte("incurred_on", period.from)
    .lte("incurred_on", period.to)
    .order("incurred_on", { ascending: false })
    .limit(6);

  return (
    <div>
      <PageHeader
        title="Costs"
       
        actions={has(profile, "add_cost") ? <Link href="/costs/new" className="btn-primary"><Plus size={14}/> Add cost</Link> : null}
      />

      <DateFilter active={period.range as Range} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Total costs (period)" value={money(grandTotal)} />
        <Kpi label="Categories used" value={String(categories.length)} />
        <Kpi label="Cost entries (period)" value={String(new Set(lis.map((l) => l.cost_id)).size)} />
        <Kpi label="Line items (period)" value={String(lis.length)} />
      </div>

      {/* Donut + legend */}
      {categories.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-semibold mb-3">Spend by category — {period.label}</h2>
          <DonutChart
            data={categories.map((c) => ({ label: c.name, value: c.total }))}
            formatValue={(n) => money(n)}
          />
        </div>
      )}

      {q && <p className="text-xs text-muted-fg mb-2">Filtered to categories matching &ldquo;{q}&rdquo;.</p>}
      <SearchBar placeholder="Search categories…" />

      {/* Category cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {categories.map((c) => {
          const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
          return (
            <Link
              key={c.name}
              href={makeCategoryHref(c.name, period.range, period.from, period.to)}
              className="card hover:border-accent transition-colors flex flex-col gap-2 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-muted-fg">Category</div>
                  <div className="font-semibold capitalize truncate">{c.name}</div>
                </div>
                <ArrowRight size={16} className="text-muted-fg group-hover:text-accent shrink-0 mt-1" />
              </div>
              <div className="text-2xl font-semibold">{money(c.total)}</div>
              <div className="flex items-center justify-between text-xs text-muted-fg">
                <span>{c.costCount} cost {c.costCount === 1 ? "entry" : "entries"} · {c.lineCount} line {c.lineCount === 1 ? "item" : "items"}</span>
                <span className="font-medium">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          );
        })}
        {!categories.length && (
          <div className="card text-sm text-muted-fg sm:col-span-2 lg:col-span-3 text-center">
            No costs recorded in {period.label}.
          </div>
        )}
      </div>

      {/* Recent entries strip */}
      <div className="card p-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <h2 className="font-semibold">Latest cost entries</h2>
          <span className="text-xs text-muted-fg">Showing 6 most recent in {period.label}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Categories</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(recent ?? []).map((c: any) => {
                const href = has(profile, "add_cost") ? `/costs/${c.id}/edit` : "#";
                return (
                  <tr key={c.id} className={has(profile, "add_cost") ? "cursor-pointer" : ""}>
                    <td><Link href={href} className="block">{fmtDate(c.incurred_on)}</Link></td>
                    <td><Link href={href} className="block">{c.description}</Link></td>
                    <td>
                      <Link href={href} className="block">
                        <div className="flex flex-wrap gap-1">
                          {(c.cost_line_items ?? []).map((li: any, i: number) => (
                            <span key={i} className="badge-muted">{li.category}</span>
                          ))}
                        </div>
                      </Link>
                    </td>
                    <td className="text-right"><Link href={href} className="block font-medium">{money(c.amount)}</Link></td>
                  </tr>
                );
              })}
              {!recent?.length && (
                <tr><td colSpan={4} className="text-center text-muted-fg py-6">Nothing in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function makeCategoryHref(name: string, range: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  params.set("range", range);
  if (range === "custom" && from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  return `/costs/by-category/${encodeURIComponent(name)}?${params.toString()}`;
}
