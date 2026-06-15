import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { DateFilter } from "@/components/DateFilter";
import { resolvePeriod, type Range } from "@/lib/period";
import { SearchBar } from "@/components/SearchBar";
import { ConfirmButton } from "@/components/ConfirmButton";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function deleteCost(formData: FormData) {
  "use server";
  await requirePermission("delete_cost");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  await sb.from("costs").delete().eq("id", id);
  revalidatePath("/costs");
}

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ page?: string; range?: string; from?: string; to?: string; q?: string }>;
}) {
  const profile = await guardView("view_costs");
  const { name: rawName } = await params;
  const category = decodeURIComponent(rawName).toLowerCase();
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const q = sp.q?.trim() || "";
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();

  // 1) Find cost_ids that have a line item with this category in the period
  let liQ = sb.from("cost_line_items")
    .select("cost_id, amount, costs!inner(incurred_on, description)")
    .eq("category", category)
    .gte("costs.incurred_on", period.from)
    .lte("costs.incurred_on", period.to);
  if (q) liQ = liQ.ilike("costs.description", `%${q}%`);
  const { data: matchingLines } = await liQ;
  const lines = (matchingLines ?? []) as any[];

  // Per-cost: amount allocated to this category
  const categoryAmountByCostId = new Map<string, number>();
  for (const li of lines) {
    categoryAmountByCostId.set(
      li.cost_id,
      (categoryAmountByCostId.get(li.cost_id) ?? 0) + Number(li.amount || 0)
    );
  }
  const allCostIds = Array.from(categoryAmountByCostId.keys());

  const totalForCategory = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const totalEntries = allCostIds.length;

  // 2) Paginate the cost rows
  const pagedIds = allCostIds.slice(from, to + 1);

  let costs: any[] = [];
  if (pagedIds.length) {
    const { data } = await sb
      .from("costs")
      .select("id, description, amount, incurred_on, cost_line_items(category, amount), cost_allocations(allocated_amount, properties(id, name))")
      .in("id", pagedIds);
    // Preserve order from allCostIds (incurred_on desc)
    const sorted = (data ?? []).slice().sort(
      (a: any, b: any) => (a.incurred_on < b.incurred_on ? 1 : a.incurred_on > b.incurred_on ? -1 : 0)
    );
    costs = sorted;
  }

  const avgPerEntry = totalEntries > 0 ? totalForCategory / totalEntries : 0;

  return (
    <div>
      <PageHeader
        title={category.charAt(0).toUpperCase() + category.slice(1)}
        subtitle="Cost category drill-down"
        actions={<Link href="/costs" className="btn-secondary text-xs">← All categories</Link>}
      />

      <DateFilter active={period.range as Range} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label={`Total ${category}`} value={money(totalForCategory)} />
        <Kpi label="Entries" value={String(totalEntries)} hint={`${lines.length} line items`} />
        <Kpi label="Avg per entry" value={money(avgPerEntry)} />
        <Kpi label="Period" value={period.label} />
      </div>

      <SearchBar placeholder="Search by cost description…" />

      <div className="card p-0">
        <div className="px-3 py-3 border-b border-border">
          <h2 className="font-semibold">All cost entries containing <span className="capitalize">{category}</span></h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>All categories in this entry</th>
                <th>Properties</th>
                <th className="text-right">{category} amount</th>
                <th className="text-right">Entry total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c: any) => {
                const li = (c.cost_line_items ?? []) as any[];
                const allocs = (c.cost_allocations ?? []) as any[];
                const catAmt = categoryAmountByCostId.get(c.id) ?? 0;
                return (
                  <tr key={c.id}>
                    <td>{fmtDate(c.incurred_on)}</td>
                    <td className="font-medium">{c.description}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {li.map((l: any, i: number) => (
                          <span
                            key={i}
                            className={l.category === category ? "badge-success" : "badge-muted"}
                          >
                            {l.category}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-xs">
                      {allocs.length === 1 && allocs[0].properties
                        ? <Link href={`/properties/${allocs[0].properties.id}`} className="hover:underline">{allocs[0].properties.name}</Link>
                        : `${allocs.length} properties (sqft-split)`}
                    </td>
                    <td className="text-right font-medium">{money(catAmt)}</td>
                    <td className="text-right text-muted-fg">{money(c.amount)}</td>
                    <td className="text-right">
                      <div className="flex gap-2 justify-end">
                        {has(profile, "add_cost") && (
                          <Link href={`/costs/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                        )}
                        {has(profile, "delete_cost") && (
                          <ConfirmButton
                            action={deleteCost}
                            hiddenInputs={{ id: c.id }}
                            confirm={`Delete cost "${c.description}"? This removes all its line items and property allocations.`}
                            label="Delete"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!costs.length && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-fg py-8">
                    {q ? `No matching costs for "${category}".` : `No costs in "${category}" for ${period.label}.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalEntries} label="entries" searchParams={sp} />
      </div>
    </div>
  );
}
