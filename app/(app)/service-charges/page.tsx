import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { SearchBar } from "@/components/SearchBar";
import { money, fmtDate } from "@/lib/format";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SCRow = {
  id: string;
  property_id: string;
  due_month: string;
  amount: number;
  status: "pending" | "paid" | "skipped" | "lessee_direct";
  paid_at: string | null;
  notes: string | null;
  properties: { id: string; name: string; compounds: { name: string } | { name: string }[] | null } | { id: string; name: string; compounds: { name: string } | { name: string }[] | null }[] | null;
};

function compoundName(c: { name: string } | { name: string }[] | null): string {
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}
function propertyOf(r: SCRow): { id: string; name: string; compounds: { name: string } | { name: string }[] | null } | null {
  if (!r.properties) return null;
  return Array.isArray(r.properties) ? r.properties[0] : r.properties;
}

async function bulkAction(formData: FormData) {
  "use server";
  await requirePermission("pay_service_charges");
  const ids = (formData.getAll("ids") as string[]).filter(Boolean);
  const action = String(formData.get("action") || "");
  if (!ids.length) return;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (action === "skip") {
    await sb.from("service_charges").update({ status: "skipped" }).in("id", ids).eq("status", "pending");
    revalidatePath("/service-charges");
    return;
  }
  if (action === "unskip") {
    await sb.from("service_charges").update({ status: "pending" }).in("id", ids).eq("status", "skipped");
    revalidatePath("/service-charges");
    return;
  }
  if (action !== "pay") return;

  // Mark paid AND mint a cost row + allocation for accounting.
  const { data: rows } = await sb
    .from("service_charges")
    .select("id, property_id, due_month, amount, status, properties(name)")
    .in("id", ids)
    .eq("status", "pending");

  for (const r of rows ?? []) {
    const propName = (() => {
      const p: any = (r as any).properties;
      return Array.isArray(p) ? p[0]?.name : p?.name;
    })();
    const desc = `Service charge ${String((r as any).due_month).slice(0, 7)} — ${propName ?? ""}`.trim();
    const { data: cost } = await sb.from("costs").insert({
      description: desc,
      category: "service_charge",
      amount: Number((r as any).amount),
      incurred_on: (r as any).due_month,
      is_auto_service_charge: false,
      created_by: user?.id ?? null,
    }).select("id").maybeSingle();
    if (cost) {
      await sb.from("cost_allocations").insert({
        cost_id: cost.id,
        property_id: (r as any).property_id,
        allocated_amount: Number((r as any).amount),
      });
      await sb.from("service_charges").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        paid_by: user?.id ?? null,
        cost_id: cost.id,
      }).eq("id", (r as any).id);
    }
  }
  revalidatePath("/service-charges");
  revalidatePath("/costs");
}

export default async function ServiceChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; tab?: string }>;
}) {
  const profile = await guardView("view_service_charges");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const tab = (sp.tab || "pending") as "pending" | "paid" | "skipped" | "lessee_direct";
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();

  // Resolve search → list of property IDs that match
  let allowedPropertyIds: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [{ data: byProp }, { data: byCompound }] = await Promise.all([
      sb.from("properties").select("id").ilike("name", like),
      sb.from("properties").select("id, compounds!inner(name)").ilike("compounds.name", like),
    ]);
    const set = new Set<string>();
    for (const r of byProp ?? []) set.add((r as { id: string }).id);
    for (const r of byCompound ?? []) set.add((r as { id: string }).id);
    allowedPropertyIds = Array.from(set);
    if (!allowedPropertyIds.length) allowedPropertyIds = ["00000000-0000-0000-0000-000000000000"];
  }

  const cols = "id, property_id, due_month, amount, status, paid_at, notes, properties(id, name, compounds(name))";

  let listQ = sb.from("service_charges").select(cols, { count: "exact" }).eq("status", tab);
  if (allowedPropertyIds) listQ = listQ.in("property_id", allowedPropertyIds);
  const pageRes = await listQ.order("due_month", { ascending: tab === "pending" }).range(from, to);

  // KPI counts (no pagination, no search filter — show overall picture)
  const [pendingSum, paidSum, skippedSum, lesseeSum] = await Promise.all([
    sb.from("service_charges").select("amount").eq("status", "pending"),
    sb.from("service_charges").select("amount").eq("status", "paid"),
    sb.from("service_charges").select("amount").eq("status", "skipped"),
    sb.from("service_charges").select("amount").eq("status", "lessee_direct"),
  ]);
  const sumOf = (rows: any[] | null | undefined) => (rows ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);

  const arr = (pageRes.data ?? []) as unknown as SCRow[];
  const total = pageRes.count ?? 0;

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "pending", label: "Pending" },
    { key: "paid", label: "Paid" },
    { key: "skipped", label: "Skipped" },
    { key: "lessee_direct", label: "Lessee direct" },
  ];

  const canPay = has(profile, "pay_service_charges");

  return (
    <div>
      <PageHeader title="Service Charges" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Pending" value={money(sumOf(pendingSum.data))} hint={`${(pendingSum.data ?? []).length} rows`} />
        <Kpi label="Paid (total)" value={money(sumOf(paidSum.data))} hint={`${(paidSum.data ?? []).length} rows`} />
        <Kpi label="Skipped" value={money(sumOf(skippedSum.data))} hint={`${(skippedSum.data ?? []).length} rows`} />
        <Kpi label="Lessee direct" value={money(sumOf(lesseeSum.data))} hint={`${(lesseeSum.data ?? []).length} rows`} />
      </div>

      <div className="card p-0 mb-4">
        <div className="flex flex-wrap gap-1 p-2 border-b border-border">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-3 py-1.5 rounded-md text-sm ${tab === t.key ? "bg-primary text-primary-fg" : "hover:bg-muted"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <SearchBar placeholder="Search by property or compound…" />

      <form action={bulkAction}>
        <div className="card p-0">
          {canPay && (tab === "pending" || tab === "skipped") && (
            <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-fg mr-auto">Tick rows then choose an action ↓</span>
              {tab === "pending" && (
                <>
                  <button name="action" value="pay" className="btn-primary text-xs">Mark selected as Paid</button>
                  <button name="action" value="skip" className="btn-secondary text-xs">Skip selected</button>
                </>
              )}
              {tab === "skipped" && (
                <button name="action" value="unskip" className="btn-secondary text-xs">Re-open selected (back to Pending)</button>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {canPay && (tab === "pending" || tab === "skipped") && <th className="w-8"><input type="checkbox" id="select-all" /></th>}
                  <th>Month</th>
                  <th>Property</th>
                  <th>Compound</th>
                  <th className="text-right">Amount</th>
                  {tab === "paid" && <th>Paid on</th>}
                  <th>Status</th>
                  {canPay && tab === "pending" && <th></th>}
                </tr>
              </thead>
              <tbody>
                {arr.map((r) => {
                  const p = propertyOf(r);
                  return (
                    <tr key={r.id}>
                      {canPay && (tab === "pending" || tab === "skipped") && (
                        <td><input type="checkbox" name="ids" value={r.id} className="sc-row-check" /></td>
                      )}
                      <td>{String(r.due_month).slice(0, 7)}</td>
                      <td>{p && <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>}</td>
                      <td className="text-xs text-muted-fg">{compoundName(p?.compounds ?? null)}</td>
                      <td className="text-right">{money(r.amount)}</td>
                      {tab === "paid" && <td>{fmtDate(r.paid_at)}</td>}
                      <td>
                        {r.status === "pending" && <span className="badge-warning">pending</span>}
                        {r.status === "paid" && <span className="badge-success">paid</span>}
                        {r.status === "skipped" && <span className="badge-muted">skipped</span>}
                        {r.status === "lessee_direct" && <span className="badge-muted">lessee direct</span>}
                      </td>
                      {canPay && tab === "pending" && (
                        <td className="text-right">
                          <button
                            name="action"
                            value="pay"
                            formAction={async (fd: FormData) => {
                              "use server";
                              fd.append("ids", r.id);
                              await bulkAction(fd);
                            }}
                            className="btn-primary text-xs"
                          >
                            Pay
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!arr.length && (
                  <tr>
                    <td colSpan={10} className="text-center text-muted-fg py-8">
                      {q ? "No matching rows." : tab === "pending" ? "Nothing pending. 👌" : "Nothing here."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} label="rows" searchParams={sp} />
        </div>
      </form>

      {/* Tiny client script to toggle all checkboxes in the visible tab */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){
              var sa = document.getElementById('select-all');
              if (!sa) return;
              sa.addEventListener('change', function(){
                document.querySelectorAll('.sc-row-check').forEach(function(b){ b.checked = sa.checked; });
              });
            })();
          `,
        }}
      />
    </div>
  );
}
