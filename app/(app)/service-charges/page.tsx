import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { SearchBar } from "@/components/SearchBar";
import { money } from "@/lib/format";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { SCTable, type SCTableRow } from "./SCRows";

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

const SC_PAGE_SIZE = 50;

export default async function ServiceChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; page?: string }>;
}) {
  const profile = await guardView("view_service_charges");
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const tab = (sp.tab || "pending") as "pending" | "paid" | "skipped" | "lessee_direct";
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * SC_PAGE_SIZE;
  const to = from + SC_PAGE_SIZE - 1;

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

  const cols = "id, property_id, due_month, amount, status, paid_at, properties(id, name, compounds(name))";

  let listQ = sb.from("service_charges")
    .select(cols, { count: "exact" })
    .eq("status", tab)
    .order("due_month", { ascending: tab === "pending" })
    .range(from, to);
  if (allowedPropertyIds) listQ = listQ.in("property_id", allowedPropertyIds);
  const listRes = await listQ;
  const totalRows = listRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / SC_PAGE_SIZE));

  // Full-tab totals for KPIs — view aggregates counts + sums per status
  // server-side (one small round-trip instead of hydrating every row).
  const { data: kpiRows } = await sb
    .from("v_sc_status_totals")
    .select("status, row_count, amount_sum");
  const kpiByStatus: Record<string, { row_count: number; amount_sum: number }> = {};
  for (const r of kpiRows ?? []) {
    const row = r as { status: string; row_count: number; amount_sum: number };
    kpiByStatus[row.status] = { row_count: Number(row.row_count), amount_sum: Number(row.amount_sum) };
  }
  const statusKpi = (s: string) => kpiByStatus[s] ?? { row_count: 0, amount_sum: 0 };

  const rows: SCTableRow[] = ((listRes.data ?? []) as any[]).map((r) => {
    const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    const cRaw = p?.compounds;
    const compoundName = cRaw ? (Array.isArray(cRaw) ? cRaw[0]?.name : cRaw.name) : "";
    return {
      id: r.id,
      due_month: String(r.due_month),
      amount: Number(r.amount),
      status: r.status,
      paid_at: r.paid_at,
      property_id: r.property_id,
      property_name: p?.name ?? "—",
      compound_name: compoundName ?? "",
    };
  });

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "pending", label: "Pending" },
    { key: "paid", label: "Paid" },
    { key: "skipped", label: "Skipped" },
    { key: "lessee_direct", label: "Lessee direct" },
  ];

  const canPay = has(profile, "pay_service_charges");

  return (
    <div>
      <PageHeader
        title="Service Charges"
        right={<SearchBar placeholder="Search property or compound…" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Pending" value={money(statusKpi("pending").amount_sum)} hint={`${statusKpi("pending").row_count} rows`} />
        <Kpi label="Paid (total)" value={money(statusKpi("paid").amount_sum)} hint={`${statusKpi("paid").row_count} rows`} />
        <Kpi label="Skipped" value={money(statusKpi("skipped").amount_sum)} hint={`${statusKpi("skipped").row_count} rows`} />
        <Kpi label="Lessee direct" value={money(statusKpi("lessee_direct").amount_sum)} hint={`${statusKpi("lessee_direct").row_count} rows`} />
      </div>

      <div className="flex flex-wrap gap-1 mb-4">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`px-3 py-1.5 rounded text-sm border ${tab === t.key ? "bg-primary text-primary-fg border-primary" : "border-border hover:border-primary hover:text-primary"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form action={bulkAction}>
        <div className="card p-0">
          {canPay && (tab === "pending" || tab === "skipped") && (
            <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 justify-end">
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
          <SCTable rows={rows} tab={tab} canPay={canPay} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-fg">
              <span>Showing {from + 1}–{Math.min(from + SC_PAGE_SIZE, totalRows)} of {totalRows}</span>
              <div className="flex gap-1">
                {page > 1 && (
                  <Link
                    href={`?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page - 1}`}
                    className="btn-secondary text-xs"
                  >
                    ← Prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page + 1}`}
                    className="btn-secondary text-xs"
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
