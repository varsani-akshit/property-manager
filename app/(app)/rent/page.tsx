import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { money } from "@/lib/format";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { LesseeAccordion, type RawRentRow, type RawCostRow } from "./LesseeAccordion";

export const dynamic = "force-dynamic";

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

async function markCostCollectedFull(formData: FormData) {
  "use server";
  await requirePermission("mark_rent");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: row } = await sb.from("costs").select("amount").eq("id", id).maybeSingle();
  if (!row) return;
  await sb.from("costs").update({
    collection_status: "collected",
    collected_amount: Number((row as { amount: number }).amount),
    collected_at: new Date().toISOString(),
    collected_by: user?.id,
  }).eq("id", id);
  revalidatePath("/rent");
}

export default async function RentPage({
  searchParams,
}: {
  searchParams: Promise<{ lessee?: string; property?: string }>;
}) {
  const profile = await guardView("view_rent");
  const sp = await searchParams;
  const filterLessee = sp.lessee?.trim() || null;
  const filterProperty = sp.property?.trim() || null;

  const sb = await supabaseServer();
  const today = todayISO();
  const upcomingHorizon = plusDaysISO(today, 183); // ~6 months
  const collectedFloor = plusDaysISO(today, -120);

  // Resolve lessee filter → lease IDs
  let leaseIds: string[] | null = null;
  if (filterLessee) {
    const { data: matchedLeases } = await sb.from("leases").select("id").ilike("lessee_name", `%${filterLessee}%`);
    leaseIds = (matchedLeases ?? []).map((l) => (l as { id: string }).id);
    if (!leaseIds.length) leaseIds = ["00000000-0000-0000-0000-000000000000"];
  }

  // RENT — three slices then merge.
  const cols = "id, due_date, gross_amount, net_amount, collected_amount, status, collected_at, lease_id, property_id, properties(name, compounds(name)), leases(id, lessee_name, lessee_contact)";

  const apply = (q: any) => {
    let out = q;
    if (filterProperty) out = out.eq("property_id", filterProperty);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    return out;
  };

  const [outstandingRes, upcomingRes, recentCollectedRes] = await Promise.all([
    apply(sb.from("rent_collections").select(cols).in("status", ["due", "partial"]).lte("due_date", today)).order("due_date", { ascending: true }),
    apply(sb.from("rent_collections").select(cols).in("status", ["due", "partial"]).gt("due_date", today).lte("due_date", upcomingHorizon)).order("due_date", { ascending: true }),
    apply(sb.from("rent_collections").select(cols).eq("status", "collected").gte("collected_at", `${collectedFloor}T00:00:00Z`)).order("collected_at", { ascending: false }),
  ]);

  const rentRows: RawRentRow[] = [
    ...((outstandingRes.data ?? []) as unknown as RawRentRow[]),
    ...((upcomingRes.data ?? []) as unknown as RawRentRow[]),
    ...((recentCollectedRes.data ?? []) as unknown as RawRentRow[]),
  ];

  // COSTS billed to a lessee — fetch unpaid (any due_date) + recently collected.
  const costCols = "id, description, amount, due_date, collected_amount, collection_status, collected_at, lease_id, leases(id, lessee_name, lessee_contact, property_id, properties(name, compounds(name))), cost_line_items(category, amount)";
  const applyCost = (q: any) => {
    let out = q.eq("payable_by_lessee", true);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    // Property filter for costs: filter via lease.property_id
    return out;
  };
  const [costDueRes, costCollectedRes] = await Promise.all([
    applyCost(sb.from("costs").select(costCols).in("collection_status", ["due", "partial"])).order("due_date", { ascending: true }),
    applyCost(sb.from("costs").select(costCols).eq("collection_status", "collected").gte("collected_at", `${collectedFloor}T00:00:00Z`)).order("collected_at", { ascending: false }),
  ]);

  let costRows: RawCostRow[] = [
    ...((costDueRes.data ?? []) as unknown as RawCostRow[]),
    ...((costCollectedRes.data ?? []) as unknown as RawCostRow[]),
  ];
  if (filterProperty) {
    costRows = costRows.filter((r) => {
      const lease = Array.isArray(r.leases) ? r.leases[0] : r.leases;
      return lease?.property_id === filterProperty;
    });
  }

  // KPIs
  const sumOutstandingRemainder = (outstandingRes.data ?? []).reduce(
    (s: number, r: any) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)),
    0
  );
  const sumUpcoming = (upcomingRes.data ?? []).reduce(
    (s: number, r: any) => s + Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0)),
    0
  );
  const sumCollected = (recentCollectedRes.data ?? []).reduce(
    (s: number, r: any) => s + Number(r.collected_amount || 0),
    0
  );
  const sumCostDue = ((costDueRes.data ?? []) as any[]).reduce(
    (s, r) => s + Math.max(0, Number(r.amount || 0) - Number(r.collected_amount || 0)),
    0
  );

  return (
    <div>
      <PageHeader
        title="Rent Collection"
        actions={<Link href="/rent/backfill" className="btn-secondary text-xs">Bulk backfill</Link>}
      />

      {(filterLessee || filterProperty) && (
        <div className="card mb-4 flex items-center justify-between gap-3">
          <p className="text-sm">
            Filtered by{" "}
            {filterLessee && <><span className="font-medium">lessee:</span> &ldquo;{filterLessee}&rdquo;</>}
            {filterLessee && filterProperty && <span className="text-muted-fg"> · </span>}
            {filterProperty && <span className="font-medium">property</span>}
          </p>
          <Link href="/rent" className="btn-secondary text-xs">Clear filter</Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Outstanding (overdue)" value={money(sumOutstandingRemainder)} hint={`${(outstandingRes.data ?? []).length} rent rows`} />
        <Kpi label="Upcoming (next 6 months)" value={money(sumUpcoming)} hint={`${(upcomingRes.data ?? []).length} rows · collectible in advance`} />
        <Kpi label="Cost Due" value={money(sumCostDue)} hint={`${(costDueRes.data ?? []).length} cost charges`} />
        <Kpi label="Collected (last 4 months)" value={money(sumCollected)} hint={`${(recentCollectedRes.data ?? []).length} rent rows`} />
      </div>

      <LesseeAccordion
        rentRows={rentRows}
        costRows={costRows}
        today={today}
        upcomingHorizon={upcomingHorizon}
        canMarkRent={has(profile, "mark_rent")}
        markFullAction={markCollectedFull}
        markCostFullAction={markCostCollectedFull}
      />
    </div>
  );
}
