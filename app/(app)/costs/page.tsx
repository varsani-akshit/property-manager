import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { money, fmtDate, firstOfMonthISO } from "@/lib/format";
import Link from "next/link";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

type CostRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  incurred_on: string;
  is_auto_service_charge: boolean;
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
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await guardView("view_costs");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const month = firstOfMonthISO();

  // Paginated page rows + aggregate KPIs computed over the entire YTD.
  const [pageRes, ytdSummary, monthSummary] = await Promise.all([
    sb.from("costs")
      .select("id, description, category, amount, incurred_on, is_auto_service_charge, cost_allocations(allocated_amount, properties(id, name))", { count: "exact" })
      .order("incurred_on", { ascending: false })
      .range(from, to),
    sb.from("costs").select("amount, category, incurred_on").gte("incurred_on", ytdStart),
    sb.from("costs").select("amount").gte("incurred_on", month),
  ]);

  const arr = (pageRes.data ?? []) as unknown as CostRow[];
  const total = pageRes.count ?? 0;

  const ytd = ytdSummary.data ?? [];
  const totalYTD = ytd.reduce((s, c) => s + Number((c as { amount: number }).amount), 0);
  const totalThisMonth = (monthSummary.data ?? []).reduce((s, c) => s + Number((c as { amount: number }).amount), 0);

  const byCategory: Record<string, number> = {};
  for (const c of ytd) {
    const row = c as { amount: number; category: string };
    byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.amount);
  }
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <PageHeader
        title="Costs"
        subtitle="Single property or multi-property (auto-split by sqft)"
        actions={has(profile, "add_cost") ? <Link href="/costs/new" className="btn-primary"><Plus size={14}/> Add cost</Link> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Costs this month" value={money(totalThisMonth)} />
        <Kpi label="Costs YTD" value={money(totalYTD)} />
        <Kpi label="Total entries" value={total.toLocaleString()} />
        <Kpi label="Top category YTD" value={topCat ? topCat[0] : "—"} hint={topCat ? money(topCat[1]) : undefined} />
      </div>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Category</th>
              <th>Properties</th><th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {arr.map((c) => (
              <tr key={c.id}>
                <td>{fmtDate(c.incurred_on)}</td>
                <td>
                  {c.description}
                  {c.is_auto_service_charge && <span className="badge-muted ml-2">auto</span>}
                </td>
                <td><span className="badge-muted">{c.category}</span></td>
                <td className="text-xs">
                  {c.cost_allocations?.length === 1 && c.cost_allocations[0].properties
                    ? <Link href={`/properties/${c.cost_allocations[0].properties.id}`} className="hover:underline">{c.cost_allocations[0].properties.name}</Link>
                    : `${c.cost_allocations?.length ?? 0} properties (split by sqft)`}
                </td>
                <td className="text-right">{money(c.amount)}</td>
                <td className="text-right">
                  <div className="flex gap-2 justify-end">
                    {has(profile, "add_cost") && !c.is_auto_service_charge && (
                      <Link href={`/costs/${c.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    )}
                    {has(profile, "delete_cost") && !c.is_auto_service_charge && (
                      <form action={deleteCost}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-danger text-xs">Delete</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!arr.length && <tr><td colSpan={6} className="text-center text-muted-fg py-8">No costs yet.</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} total={total} label="costs" />
      </div>
    </div>
  );
}
