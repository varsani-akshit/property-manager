import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { money } from "@/lib/format";
import { has } from "@/lib/permissions";
import { guardView } from "@/lib/guard";
import Link from "next/link";
import { BULK_BACKFILL_ENABLED } from "@/lib/features";
import { fetchAll } from "@/lib/fetch-all";
import { LesseeAccordion, type LiteRentRow, type LeaseRef, type PropertyRef, type RawCostRow } from "./LesseeAccordion";

export const dynamic = "force-dynamic";

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function plusDaysISO(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
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
  // Rent rows carry only their own figures; lessee / property names are sent once
  // (leaseRefs / propertyRefs below) — keeps the page light on mobile data.
  const cols = "id, due_date, net_amount, collected_amount, status, collected_at, lease_id, property_id";

  const apply = (q: any) => {
    let out = q;
    if (filterProperty) out = out.eq("property_id", filterProperty);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    return out;
  };

  // COSTS billed to a lessee — fetch unpaid (any due_date) + recently collected.
  const costCols = "id, description, amount, due_date, collected_amount, collection_status, collected_at, lease_id, leases(id, lessee_name, lessee_contact, property_id, properties(name, compounds(name))), cost_line_items(category, amount)";
  const applyCost = (q: any) => {
    let out = q.eq("payable_by_lessee", true);
    if (leaseIds) out = out.in("lease_id", leaseIds);
    // Property filter for costs: filter via lease.property_id
    return out;
  };

  let depositsQ = sb.from("leases")
    .select("lessee_name, deposit_charged, deposit_collected, property_id")
    .eq("active", true);
  if (leaseIds) depositsQ = depositsQ.in("id", leaseIds);
  if (filterProperty) depositsQ = depositsQ.eq("property_id", filterProperty);
  // Paged: portfolio-wide rent rows easily pass Supabase's 1,000-row response cap.
  const [outstandingRows, upcomingRows, recentCollectedRows, costDueRes, costCollectedRes, { data: depositsData }, { data: leaseRefRows }, { data: propRefRows }] = await Promise.all([
    fetchAll<any>((f, t) => apply(sb.from("rent_collections").select(cols).in("status", ["due", "partial"]).lte("due_date", today)).order("due_date", { ascending: true }).range(f, t)),
    fetchAll<any>((f, t) => apply(sb.from("rent_collections").select(cols).in("status", ["due", "partial"]).gt("due_date", today).lte("due_date", upcomingHorizon)).order("due_date", { ascending: true }).range(f, t)),
    fetchAll<any>((f, t) => apply(sb.from("rent_collections").select(cols).eq("status", "collected").gte("collected_at", `${collectedFloor}T00:00:00Z`)).order("collected_at", { ascending: false }).range(f, t)),
    applyCost(sb.from("costs").select(costCols).in("collection_status", ["due", "partial"])).order("due_date", { ascending: true }),
    applyCost(sb.from("costs").select(costCols).eq("collection_status", "collected").gte("collected_at", `${collectedFloor}T00:00:00Z`)).order("collected_at", { ascending: false }),
    depositsQ,
    sb.from("leases").select("id, lessee_name, lessee_contact"),
    sb.from("properties").select("id, name, compounds(name)"),
  ]);
  const leaseRefs: Record<string, LeaseRef> = Object.fromEntries((leaseRefRows ?? []).map((l: any) => [l.id, { id: l.id, lessee_name: l.lessee_name, lessee_contact: l.lessee_contact }]));
  const propertyRefs: Record<string, PropertyRef> = Object.fromEntries((propRefRows ?? []).map((p: any) => [p.id, { name: p.name, compounds: p.compounds }]));
  const outstandingRes = { data: outstandingRows };
  const upcomingRes = { data: upcomingRows };
  const recentCollectedRes = { data: recentCollectedRows };

  const rentRows: LiteRentRow[] = [
    ...((outstandingRes.data ?? []) as LiteRentRow[]),
    ...((upcomingRes.data ?? []) as LiteRentRow[]),
    ...((recentCollectedRes.data ?? []) as LiteRentRow[]),
  ];

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

  // DEPOSITS — active leases only, keyed by lessee_name (fetched with the rest above)
  const depositShortfallByLessee: Record<string, number> = {};
  for (const l of depositsData ?? []) {
    const row = l as { lessee_name: string; deposit_charged: number | null; deposit_collected: number | null };
    const shortfall = Math.max(0, Number(row.deposit_charged ?? 0) - Number(row.deposit_collected ?? 0));
    depositShortfallByLessee[row.lessee_name] = (depositShortfallByLessee[row.lessee_name] ?? 0) + shortfall;
  }
  const totalDepositShortfall = Object.values(depositShortfallByLessee).reduce((s, v) => s + v, 0);

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
        subtitle="Overdue and upcoming rent, lessee-billed costs and deposits, grouped by lessee."
        actions={BULK_BACKFILL_ENABLED ? <Link href="/rent/backfill" className="btn-secondary">Bulk backfill</Link> : null}
      />

      {(filterLessee || filterProperty) && (
        <div className="notice-info items-center justify-between">
          <p>
            Filtered by{" "}
            {filterLessee && <><span className="font-medium">lessee:</span> &ldquo;{filterLessee}&rdquo;</>}
            {filterLessee && filterProperty && <span className="text-muted-fg"> · </span>}
            {filterProperty && <span className="font-medium">property</span>}
          </p>
          <Link href="/rent" className="btn-secondary btn-sm">Clear filter</Link>
        </div>
      )}

      <div className="stat-row mb-6">
        <Kpi label="Outstanding (overdue)" value={money(sumOutstandingRemainder)} hint={`${(outstandingRes.data ?? []).length} rent rows`} />
        <Kpi label="Upcoming (next 6 months)" value={money(sumUpcoming)} hint={`${(upcomingRes.data ?? []).length} rows`} />
        <Kpi label="Cost Due" value={money(sumCostDue)} hint={`${(costDueRes.data ?? []).length} cost charges`} />
        <Kpi label="Deposit shortfall" value={money(totalDepositShortfall)} hint="Active leases" />
        <Kpi label="Collected (last 4 mo)" value={money(sumCollected)} hint={`${(recentCollectedRes.data ?? []).length} rent rows`} />
      </div>

      <LesseeAccordion
        rentRows={rentRows}
        leaseRefs={leaseRefs}
        propertyRefs={propertyRefs}
        costRows={costRows}
        depositShortfallByLessee={depositShortfallByLessee}
        today={today}
        upcomingHorizon={upcomingHorizon}
        canMarkRent={has(profile, "mark_rent")}
      />
    </div>
  );
}
