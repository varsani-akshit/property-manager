import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";
import { money, fmtDate } from "@/lib/format";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export const dynamic = "force-dynamic";

type RentRow = {
  id: string;
  due_date: string;
  gross_amount: number;
  service_charge_deduction: number;
  net_amount: number;
  collected_amount: number;
  status: string;
  collected_at: string | null;
  property_id: string;
  properties: { name: string } | { name: string }[] | null;
  leases: { lessee_name: string; lessee_contact: string | null } | { lessee_name: string; lessee_contact: string | null }[] | null;
};

function pickOne<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function plusDaysISO(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function markCollectedFull(formData: FormData) {
  "use server";
  await requirePermission("mark_rent");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: row } = await sb.from("rent_collections").select("net_amount").eq("id", id).maybeSingle();
  if (!row) return;
  await sb.from("rent_collections").update({
    status: "collected",
    collected_amount: Number((row as { net_amount: number }).net_amount),
    collected_at: new Date().toISOString(),
    collected_by: user?.id,
  }).eq("id", id);
  revalidatePath("/rent");
}

export default async function RentPage({
  searchParams,
}: {
  searchParams: Promise<{ overdue_page?: string; soon_page?: string; collected_page?: string; lessee?: string; property?: string }>;
}) {
  const profile = await guardView("view_rent");
  const sp = await searchParams;
  const overduePage = parsePage(sp.overdue_page);
  const soonPage = parsePage(sp.soon_page);
  const collectedPage = parsePage(sp.collected_page);
  const filterLessee = sp.lessee?.trim() || null;
  const filterProperty = sp.property?.trim() || null;

  const sb = await supabaseServer();
  const today = todayISO();
  const horizon = plusDaysISO(today, 7);

  const rangeFor = (p: number): [number, number] => [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1];
  const cols = "id, due_date, gross_amount, service_charge_deduction, net_amount, collected_amount, status, collected_at, property_id, properties(name), leases(lessee_name, lessee_contact)";

  let leaseIds: string[] | null = null;
  if (filterLessee) {
    const { data: matchedLeases } = await sb.from("leases").select("id").ilike("lessee_name", `%${filterLessee}%`);
    leaseIds = (matchedLeases ?? []).map((l) => (l as { id: string }).id);
    if (!leaseIds.length) leaseIds = ["00000000-0000-0000-0000-000000000000"];
  }
  const withFilters = (q: any): any => {
    let out = q;
    if (filterProperty) out = out.eq("property_id", filterProperty);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    return out;
  };

  // Outstanding (overdue) = (due OR partial) AND due_date <= today
  // Due soon         = (due OR partial) AND due_date > today AND due_date <= horizon
  // Collected        = status='collected'
  const dueStatuses = ["due", "partial"];

  const [overdueRes, soonRes, collectedRes, overdueSum, soonSum, collectedSum] = await Promise.all([
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).in("status", dueStatuses).lte("due_date", today))
      .order("due_date", { ascending: true }).range(...rangeFor(overduePage)),
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).in("status", dueStatuses).gt("due_date", today).lte("due_date", horizon))
      .order("due_date", { ascending: true }).range(...rangeFor(soonPage)),
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).eq("status", "collected"))
      .order("collected_at", { ascending: false }).range(...rangeFor(collectedPage)),
    withFilters(sb.from("rent_collections").select("net_amount, collected_amount").in("status", dueStatuses).lte("due_date", today)),
    withFilters(sb.from("rent_collections").select("net_amount, collected_amount").in("status", dueStatuses).gt("due_date", today).lte("due_date", horizon)),
    withFilters(sb.from("rent_collections").select("collected_amount").eq("status", "collected")),
  ]);

  // Outstanding sums = remainder (net - collected_amount)
  const sumOutstanding = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)), 0);
  const sumCollected = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Number(r.collected_amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Rent Collection"
        subtitle="Due dates follow each lease's start day-of-month. Partial collections supported."
      />

      {(filterLessee || filterProperty) && (
        <div className="card mb-4 flex items-center justify-between gap-3 bg-accent/5 border-accent/30">
          <p className="text-sm">
            Filtered by{" "}
            {filterLessee && <><span className="font-medium">lessee:</span> &ldquo;{filterLessee}&rdquo;</>}
            {filterLessee && filterProperty && <span className="text-muted-fg"> · </span>}
            {filterProperty && <><span className="font-medium">property</span></>}
          </p>
          <Link href="/rent" className="btn-secondary text-xs">Clear filter</Link>
        </div>
      )}

      <form action="" method="get" className="card mb-4 flex flex-col sm:flex-row gap-2">
        <input type="search" name="lessee" defaultValue={filterLessee ?? ""} placeholder="Search by lessee name…" className="input flex-1" />
        <button className="btn-primary text-sm">Search</button>
        {(filterLessee || filterProperty) && <Link href="/rent" className="btn-secondary text-sm">Clear</Link>}
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="Outstanding (overdue)" value={money(sumOutstanding(overdueSum.data))} hint={`${(overdueRes.count ?? 0).toLocaleString()} rows`} />
        <Kpi label="Due soon (≤7 days)" value={money(sumOutstanding(soonSum.data))} hint={`${(soonRes.count ?? 0).toLocaleString()} rows`} />
        <Kpi label="Collected (total)" value={money(sumCollected(collectedSum.data))} hint={`${(collectedRes.count ?? 0).toLocaleString()} rows`} />
      </div>

      <Section
        title="Outstanding — due today or earlier"
        rows={(overdueRes.data ?? []) as unknown as RentRow[]}
        total={overdueRes.count ?? 0}
        page={overduePage}
        pageParam="overdue_page"
        searchParams={sp}
        emptyText="Nothing overdue. 👌"
        showActions={has(profile, "mark_rent")}
        markFullAction={markCollectedFull}
        kind="overdue"
      />

      <Section
        title="Due soon — within the next 7 days"
        rows={(soonRes.data ?? []) as unknown as RentRow[]}
        total={soonRes.count ?? 0}
        page={soonPage}
        pageParam="soon_page"
        searchParams={sp}
        emptyText="Nothing due in the next 7 days."
        showActions={has(profile, "mark_rent")}
        markFullAction={markCollectedFull}
        kind="due_soon"
      />

      <Section
        title="Collected"
        rows={(collectedRes.data ?? []) as unknown as RentRow[]}
        total={collectedRes.count ?? 0}
        page={collectedPage}
        pageParam="collected_page"
        searchParams={sp}
        emptyText="No collections yet."
        showActions={false}
        markFullAction={markCollectedFull}
        kind="collected"
        showCollectedAt
      />
    </div>
  );
}

function Section({
  title, rows, total, page, pageParam, searchParams,
  emptyText, showActions, markFullAction, kind, showCollectedAt,
}: {
  title: string;
  rows: RentRow[];
  total: number;
  page: number;
  pageParam: string;
  searchParams: Record<string, string | undefined>;
  emptyText: string;
  showActions: boolean;
  markFullAction: (fd: FormData) => Promise<void>;
  kind: "overdue" | "due_soon" | "collected";
  showCollectedAt?: boolean;
}) {
  const badgeFor = (r: RentRow) => {
    if (r.status === "collected") return "badge-success";
    if (r.status === "partial") return "badge-warning";
    return kind === "overdue" ? "badge-danger" : "badge-warning";
  };
  const labelFor = (r: RentRow) => {
    if (r.status === "collected") return "collected";
    if (r.status === "partial") return "partial";
    return kind === "overdue" ? "overdue" : "due soon";
  };

  return (
    <div className="card mb-6 p-0">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-fg">{total.toLocaleString()} row{total === 1 ? "" : "s"}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{showCollectedAt ? "Collected on" : "Due date"}</th>
              <th>Property</th>
              <th>Lessee</th>
              <th className="text-right">Net expected</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Outstanding</th>
              <th>Status</th>
              {showActions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = pickOne(r.properties);
              const l = pickOne(r.leases);
              const outstanding = Math.max(0, Number(r.net_amount) - Number(r.collected_amount));
              return (
                <tr key={r.id}>
                  <td>{showCollectedAt ? fmtDate(r.collected_at) : fmtDate(r.due_date)}</td>
                  <td>{p?.name}</td>
                  <td>{l?.lessee_name}</td>
                  <td className="text-right">{money(r.net_amount)}</td>
                  <td className="text-right">{money(r.collected_amount)}</td>
                  <td className={`text-right font-medium ${outstanding > 0 ? "text-danger" : ""}`}>{money(outstanding)}</td>
                  <td><span className={badgeFor(r)}>{labelFor(r)}</span></td>
                  {showActions && (
                    <td className="text-right">
                      <div className="flex gap-1 justify-end">
                        <form action={markFullAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn-primary text-xs">Mark collected</button>
                        </form>
                        <Link href={`/rent/${r.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={showActions ? 8 : 7} className="text-center text-muted-fg py-6">{emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} paramName={pageParam} searchParams={searchParams} label="rows" />
    </div>
  );
}
