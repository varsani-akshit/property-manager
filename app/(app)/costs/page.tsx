import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { SearchBar } from "@/components/SearchBar";
import { money, fmtDate, firstOfMonthISO } from "@/lib/format";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import { Plus } from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

type CostRow = {
  id: string;
  description: string;
  amount: number;
  incurred_on: string;
  is_auto_service_charge: boolean;
  cost_line_items: { category: string; amount: number }[] | null;
  cost_allocations: { allocated_amount: number; properties: { id: string; name: string } | null }[] | null;
};

async function deleteCost(formData: FormData) {
  "use server";
  await requirePermission("delete_cost");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  await sb.from("costs").delete().eq("id", id);
  revalidatePath("/costs");
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const profile = await guardView("view_costs");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const month = firstOfMonthISO();

  let allowedCostIds: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [{ data: byDesc }, { data: byCat }, { data: byAlloc }] = await Promise.all([
      sb.from("costs").select("id").ilike("description", like),
      sb.from("cost_line_items").select("cost_id").ilike("category", like),
      sb.from("cost_allocations").select("cost_id, properties!inner(name)").ilike("properties.name", like),
    ]);
    const set = new Set<string>();
    for (const r of byDesc ?? []) set.add((r as { id: string }).id);
    for (const r of byCat ?? []) set.add((r as { cost_id: string }).cost_id);
    for (const r of byAlloc ?? []) set.add((r as { cost_id: string }).cost_id);
    allowedCostIds = Array.from(set);
    if (!allowedCostIds.length) allowedCostIds = ["00000000-0000-0000-0000-000000000000"];
  }

  let listQ = sb.from("costs").select(
    "id, description, amount, incurred_on, is_auto_service_charge, cost_line_items(category, amount), cost_allocations(allocated_amount, properties(id, name))",
    { count: "exact" }
  );
  if (allowedCostIds) listQ = listQ.in("id", allowedCostIds);
  const [pageRes, ytdSummary, monthSummary, ytdCats] = await Promise.all([
    listQ.order("incurred_on", { ascending: false }).range(from, to),
    sb.from("costs").select("amount").gte("incurred_on", ytdStart),
    sb.from("costs").select("amount").gte("incurred_on", month),
    // Top-category aggregation uses line items so multi-category costs are split.
    sb.from("cost_line_items").select("category, amount, costs!inner(incurred_on)").gte("costs.incurred_on", ytdStart),
  ]);

  const arr = (pageRes.data ?? []) as unknown as CostRow[];
  const total = pageRes.count ?? 0;
  const totalYTD = (ytdSummary.data ?? []).reduce((s, c) => s + Number((c as { amount: number }).amount), 0);
  const totalThisMonth = (monthSummary.data ?? []).reduce((s, c) => s + Number((c as { amount: number }).amount), 0);

  const byCategory: Record<string, number> = {};
  for (const li of ytdCats.data ?? []) {
    const row = li as { category: string; amount: number };
    byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.amount);
  }
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <PageHeader
        title="Costs"
        subtitle="Each cost can have multiple categorized line items. Allocate to one property or split across many by sqft."
        actions={has(profile, "add_cost") ? <Link href="/costs/new" className="btn-primary"><Plus size={14}/> Add cost</Link> : null}
      />

      <SearchBar placeholder="Search by description, category, or property…" q={q} searchParams={sp} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Costs this month" value={money(totalThisMonth)} />
        <Kpi label="Costs YTD" value={money(totalYTD)} />
        <Kpi label="Total entries" value={total.toLocaleString()} />
        <Kpi label="Top category YTD" value={topCat ? topCat[0] : "—"} hint={topCat ? money(topCat[1]) : undefined} />
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Categories &amp; line items</th>
                <th>Properties</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {arr.map((c) => (
                <tr key={c.id}>
                  <td className="align-top">{fmtDate(c.incurred_on)}</td>
                  <td className="align-top">
                    <div className="font-medium">{c.description}</div>
                    {c.is_auto_service_charge && <span className="badge-muted">auto</span>}
                  </td>
                  <td className="align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {(c.cost_line_items ?? []).map((li, i) => (
                        <span key={i} className="badge-muted whitespace-nowrap">
                          {li.category} · {money(li.amount)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs align-top">
                    {c.cost_allocations?.length === 1 && c.cost_allocations[0].properties
                      ? <Link href={`/properties/${c.cost_allocations[0].properties.id}`} className="hover:underline">{c.cost_allocations[0].properties.name}</Link>
                      : `${c.cost_allocations?.length ?? 0} properties (split by sqft)`}
                  </td>
                  <td className="text-right font-medium align-top">{money(c.amount)}</td>
                  <td className="text-right align-top">
                    <div className="flex gap-2 justify-end">
                      {has(profile, "add_cost") && !c.is_auto_service_charge && (
                        <Link href={`/costs/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                      )}
                      {has(profile, "delete_cost") && !c.is_auto_service_charge && (
                        <ConfirmButton
                          action={deleteCost}
                          hiddenInputs={{ id: c.id }}
                          confirm={`Delete cost "${c.description}"? This removes all its line items and property allocations. This cannot be undone.`}
                          label="Delete"
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!arr.length && <tr><td colSpan={6} className="text-center text-muted-fg py-8">{q ? "No matching costs." : "No costs yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} label="costs" searchParams={sp} />
      </div>
    </div>
  );
}
