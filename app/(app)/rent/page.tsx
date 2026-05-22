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
  status: string;
  collected_at: string | null;
  properties: { name: string } | { name: string }[] | null;
  leases: { lessee_name: string; lessee_contact: string | null } | { lessee_name: string; lessee_contact: string | null }[] | null;
};

function pickOne<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function markCollected(formData: FormData) {
  "use server";
  await requirePermission("mark_rent");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  await sb.from("rent_collections").update({
    status: "collected",
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

  // Per-section ranges
  const rangeFor = (p: number): [number, number] => [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1];

  const cols = "id, due_date, gross_amount, service_charge_deduction, net_amount, status, collected_at, property_id, properties(name), leases(lessee_name, lessee_contact)";

  // Pre-resolve lessee filter → list of lease_ids matching the name (case-insensitive).
  let leaseIds: string[] | null = null;
  if (filterLessee) {
    const { data: matchedLeases } = await sb
      .from("leases")
      .select("id")
      .ilike("lessee_name", `%${filterLessee}%`);
    leaseIds = (matchedLeases ?? []).map((l) => (l as { id: string }).id);
    if (leaseIds.length === 0) leaseIds = ["00000000-0000-0000-0000-000000000000"]; // forces empty result
  }

  // Apply property_id + lease_id filters to a builder.
  type Q = ReturnType<typeof sb.from> extends any ? any : any;
  const withFilters = (q: any): any => {
    let out = q;
    if (filterProperty) out = out.eq("property_id", filterProperty);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    return out;
  };

  const [overdueRes, soonRes, collectedRes, overdueSum, soonSum, collectedSum] = await Promise.all([
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).eq("status", "due").lte("due_date", today))
      .order("due_date", { ascending: true }).range(...rangeFor(overduePage)),
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).eq("status", "due").gt("due_date", today).lte("due_date", horizon))
      .order("due_date", { ascending: true }).range(...rangeFor(soonPage)),
    withFilters(sb.from("rent_collections").select(cols, { count: "exact" }).eq("status", "collected"))
      .order("collected_at", { ascending: false }).range(...rangeFor(collectedPage)),
    withFilters(sb.from("rent_collections").select("net_amount").eq("status", "due").lte("due_date", today)),
    withFilters(sb.from("rent_collections").select("net_amount").eq("status", "due").gt("due_date", today).lte("due_date", horizon)),
    withFilters(sb.from("rent_collections").select("net_amount").eq("status", "collected")),
  ]);

  const sumOf = (rows: { net_amount: number }[] | null | undefined) => (rows ?? []).reduce((s, r) => s + Number(r.net_amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Rent Collection"
        subtitle="Due dates follow each lease's start day-of-month. Buckets update automatically every day."
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="Outstanding (overdue)" value={money(sumOf(overdueSum.data as any))} hint={`${(overdueRes.count ?? 0).toLocaleString()} rows`} />
        <Kpi label="Due soon (≤7 days)" value={money(sumOf(soonSum.data as any))} hint={`${(soonRes.count ?? 0).toLocaleString()} rows`} />
        <Kpi label="Collected (total)" value={money(sumOf(collectedSum.data as any))} hint={`${(collectedRes.count ?? 0).toLocaleString()} rows`} />
      </div>

      <Section
        title="Outstanding — due today or earlier"
        rows={(overdueRes.data ?? []) as unknown as RentRow[]}
        total={overdueRes.count ?? 0}
        page={overduePage}
        pageParam="overdue_page"
        searchParams={sp}
        emptyText="Nothing overdue. 👌"
        showMark={has(profile, "mark_rent")}
        markAction={markCollected}
        emphasizeStatus="overdue"
      />

      <Section
        title="Due soon — within the next 7 days"
        rows={(soonRes.data ?? []) as unknown as RentRow[]}
        total={soonRes.count ?? 0}
        page={soonPage}
        pageParam="soon_page"
        searchParams={sp}
        emptyText="Nothing due in the next 7 days."
        showMark={has(profile, "mark_rent")}
        markAction={markCollected}
        emphasizeStatus="due_soon"
      />

      <Section
        title="Collected"
        rows={(collectedRes.data ?? []) as unknown as RentRow[]}
        total={collectedRes.count ?? 0}
        page={collectedPage}
        pageParam="collected_page"
        searchParams={sp}
        emptyText="No collections yet."
        showMark={false}
        markAction={markCollected}
        emphasizeStatus="collected"
        showCollectedAt
      />
    </div>
  );
}

function Section({
  title, rows, total, page, pageParam, searchParams, emptyText, showMark, markAction, emphasizeStatus, showCollectedAt,
}: {
  title: string;
  rows: RentRow[];
  total: number;
  page: number;
  pageParam: string;
  searchParams: Record<string, string | undefined>;
  emptyText: string;
  showMark: boolean;
  markAction: (fd: FormData) => Promise<void>;
  emphasizeStatus: "due_soon" | "overdue" | "collected";
  showCollectedAt?: boolean;
}) {
  const badge =
    emphasizeStatus === "overdue" ? "badge-danger" :
    emphasizeStatus === "due_soon" ? "badge-warning" :
    "badge-success";

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
              <th>Contact</th>
              <th className="text-right">Gross</th>
              <th className="text-right">SC deduction</th>
              <th className="text-right">Net</th>
              <th></th>
              {showMark && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = pickOne(r.properties);
              const l = pickOne(r.leases);
              return (
                <tr key={r.id}>
                  <td>{showCollectedAt ? fmtDate(r.collected_at) : fmtDate(r.due_date)}</td>
                  <td>{p?.name}</td>
                  <td>{l?.lessee_name}</td>
                  <td>{l?.lessee_contact || "—"}</td>
                  <td className="text-right">{money(r.gross_amount)}</td>
                  <td className="text-right text-muted-fg">{money(r.service_charge_deduction)}</td>
                  <td className="text-right font-medium">{money(r.net_amount)}</td>
                  <td><span className={badge}>{emphasizeStatus.replace("_", " ")}</span></td>
                  {showMark && (
                    <td className="text-right">
                      <form action={markAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn-primary text-xs">Mark collected</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={showMark ? 9 : 8} className="text-center text-muted-fg py-6">{emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} paramName={pageParam} searchParams={searchParams} label="rows" />
    </div>
  );
}
