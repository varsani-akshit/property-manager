import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { has, type Permission, type UserProfile } from "@/lib/permissions";
import { resolvePeriod } from "@/lib/period";
import { outstandingByLessee } from "@/lib/outstanding";
import { buildStatement } from "@/lib/statement";
import { fetchAll } from "@/lib/fetch-all";
import { getDashboardSnapshot } from "@/lib/dashboard-cache";
import { methodLabel, PAYMENT_METHODS } from "@/lib/payment-methods";
import { revalidateApp } from "@/lib/revalidate";
import { getAnalyticsFacts } from "@/lib/analytics/server";
import {
  aging as agingBuckets, breakdown, expiryTimeline, forecast as rentForecast, insights as analyticsInsights,
  metrics as analyticsMetrics, monthly, overdueItems, presetRange, previousRange, scopeOf, type Dim, type Filters,
} from "@/lib/analytics/compute";

/**
 * Variaka's MCP tools. One list drives the server (app/api/mcp), the tool list
 * on the API keys page, and the permission checks: every tool names the
 * permission the key's owner must hold. Amounts are Kenyan shillings (KES).
 */

export type ToolCtx = { profile: UserProfile; sb: SupabaseClient };
type Def<S extends z.ZodObject> = {
  name: string;
  title: string;
  summary: string;       // one line, shown in the app
  description: string;   // what the model reads
  perm: Permission;
  writes?: boolean;
  input: S;
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
};
const def = <S extends z.ZodObject>(d: Def<S>) => d;

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
/** A YYYY-MM-DD range; missing ends default to "last 3 months up to today". */
const period = (from?: string, to?: string) => {
  if (!from && !to) return resolvePeriod({ range: "3m" });
  return resolvePeriod({ range: "custom", from: from ?? resolvePeriod({ range: "3m" }).from, to: to ?? today() });
};

async function findLeaseIds(sb: SupabaseClient, lessee: string) {
  const { data } = await sb.from("leases").select("id, lessee_name").ilike("lessee_name", `%${lessee}%`);
  return (data ?? []) as { id: string; lessee_name: string }[];
}

export const TOOLS = [
  def({
    name: "portfolio_summary",
    title: "Portfolio summary",
    summary: "Headline numbers: collected, billed, collection rate, outstanding, costs, net, occupancy, ROI.",
    description: "Headline figures for a period (defaults to the last 3 months): rent collected, rent billed, collection rate, total overdue, owner costs, net, occupancy, portfolio valuation and annualised ROI. Use this first for any 'how are we doing' question.",
    perm: "view_dashboard",
    input: z.object({ from: ISO.optional().describe("Start date YYYY-MM-DD"), to: ISO.optional().describe("End date YYYY-MM-DD (default today)") }),
    run: async ({ from, to }) => {
      const p = period(from, to);
      const s: any = await getDashboardSnapshot(p.from, p.to);
      const collected = (s.collected ?? []).reduce((a: number, r: any) => a + Number(r.net_amount || 0), 0);
      const billed = (s.dueInPeriod ?? []).reduce((a: number, r: any) => a + Number(r.net_amount || 0), 0);
      const costs = (s.costs ?? []).reduce((a: number, r: any) => a + Number(r.allocated_amount || 0), 0);
      const props: any[] = s.properties ?? [];
      const leases: any[] = s.leases ?? [];
      const valuation = props.reduce((a, x) => a + Number(x.valuation || 0), 0);
      const days = Math.max(1, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1);
      const net = collected - costs;
      return {
        period: { from: p.from, to: p.to },
        currency: "KES",
        rent_collected: r2(collected),
        rent_billed: r2(billed),
        collection_rate_pct: billed > 0 ? r2((collected / billed) * 100) : null,
        overdue_now: r2(Number(s.overdueTotals?.amount || 0)),
        overdue_lessees: Number(s.overdueTotals?.distinct_lessees || 0),
        oldest_overdue_days: Number(s.overdueTotals?.oldest_days || 0),
        owner_costs: r2(costs),
        net: r2(net),
        properties: props.length,
        leased: leases.length,
        occupancy_pct: props.length ? r2((leases.length / props.length) * 100) : null,
        expected_rent_per_month: r2(leases.reduce((a, l) => a + Number(l.gross_rent_monthly || 0), 0)),
        portfolio_valuation: r2(valuation),
        roi_annualised_pct: valuation > 0 ? r2((net / valuation) * (365 / days) * 100) : null,
      };
    },
  }),

  def({
    name: "analyze",
    title: "Analyze the portfolio",
    summary: "The dashboard's analytics for any slice: KPIs vs previous period, ranking, trend, aging, insights.",
    description: "Run the dashboard analytics for any combination of period, compound(s), property(ies) and client(s)/lessee(s) (names, partial matches allowed). Returns KPIs for the period and the previous period of equal length (rent received, billed, collection rate, outstanding, net, occupancy, rent roll, yield, deposits), a breakdown ranked by a chosen metric at compound / property / lessee level, the monthly trend, overdue aging buckets, upcoming lease expiries, a 6-month forecast and plain-language insights. Use this for comparisons and 'why' questions; call it several times to compare slices.",
    perm: "view_dashboard",
    input: z.object({
      from: ISO.optional().describe("Start YYYY-MM-DD (default: 12 months ago)"),
      to: ISO.optional().describe("End YYYY-MM-DD (default today)"),
      compounds: z.array(z.string()).default([]).describe("Compound names (partial ok)"),
      properties: z.array(z.string()).default([]).describe("Property names (partial ok)"),
      lessees: z.array(z.string()).default([]).describe("Lessee / client names (partial ok)"),
      breakdown_by: z.enum(["compound", "property", "lessee"]).default("compound"),
      rank_by: z.enum(["outstanding", "received", "billed", "collectionRate", "net", "yieldPct", "occupancy", "monthlyRent", "valuation", "oldestDays"]).default("outstanding"),
      limit: z.number().int().min(1).max(100).default(15),
      include_monthly: z.boolean().default(true),
    }),
    run: async (a) => {
      const f = await getAnalyticsFacts();
      const match = (list: string[], q: string[]) => list.map((n, i) => ({ n, i })).filter(({ n }) => q.some((x) => n.toLowerCase().includes(x.toLowerCase())));
      const comps = match(f.compounds.map((c) => c.name), a.compounds);
      const props = match(f.properties.map((p) => p.name), a.properties);
      const lessees = f.lessees.filter((n) => a.lessees.some((x) => n.toLowerCase().includes(x.toLowerCase())));
      const unmatched = [
        ...a.compounds.filter((x) => !comps.some(({ n }) => n.toLowerCase().includes(x.toLowerCase()))).map((x) => `compound "${x}"`),
        ...a.properties.filter((x) => !props.some(({ n }) => n.toLowerCase().includes(x.toLowerCase()))).map((x) => `property "${x}"`),
        ...a.lessees.filter((x) => !lessees.some((n) => n.toLowerCase().includes(x.toLowerCase()))).map((x) => `lessee "${x}"`),
      ];
      if (unmatched.length) return { error: `No match for ${unmatched.join(", ")}.`, hint: "Use search to find exact names." };
      const r = a.from || a.to ? { from: a.from ?? presetRange("12m", f.today).from, to: a.to ?? f.today } : presetRange("12m", f.today);
      const flt: Filters = { preset: "custom", ...r, compounds: comps.map((c) => c.i), properties: props.map((p) => p.i), lessees, staff: [], compare: true };
      const scope = scopeOf(f, flt);
      const cur = analyticsMetrics(f, scope, flt.from, flt.to);
      const pr = previousRange(flt.from, flt.to);
      const prev = analyticsMetrics(f, scope, pr.from, pr.to);
      const rows = breakdown(f, flt, a.breakdown_by as Dim);
      const byLessee = a.breakdown_by === "lessee" ? rows : breakdown(f, flt, "lessee");
      const byProperty = a.breakdown_by === "property" ? rows : breakdown(f, flt, "property");
      const items = overdueItems(f, scope);
      const pick = (m: typeof cur) => ({
        rent_received: r2(m.received), rent_billed: r2(m.billed), collection_rate_pct: m.collectionRate != null ? r2(m.collectionRate * 100) : null,
        outstanding_now: r2(m.outstanding), overdue_lessees: m.overdueLessees, oldest_overdue_days: m.oldestDays,
        landlord_costs: r2(m.costs), net: r2(m.net), units: m.units, leased: m.leased, occupancy_pct: m.occupancy != null ? r2(m.occupancy * 100) : null,
        rent_roll_per_month: r2(m.monthlyRent), rent_per_sqft: m.rentPerSqft != null ? r2(m.rentPerSqft) : null, valuation: r2(m.valuation),
        yield_annualised_pct: m.yieldPct != null ? r2(m.yieldPct * 100) : null, deposit_shortfall: r2(m.depositShortfall),
        lessee_charges_outstanding: r2(m.chargesOutstanding), leases_ending_90d: m.expiring90, rent_at_risk_90d: r2(m.expiring90Rent),
        paid_on_time_pct: m.onTimePct != null ? r2(m.onTimePct * 100) : null,
      });
      const key = a.rank_by as keyof typeof cur;
      return {
        currency: "KES",
        scope: { period: r, previous_period: pr, compounds: comps.map((c) => c.n), properties: props.map((p) => p.n), lessees },
        current: pick(cur),
        previous: pick(prev),
        breakdown: {
          by: a.breakdown_by, ranked_by: a.rank_by,
          rows: rows.filter((x) => x.m[key] != null).sort((x, y) => Number(y.m[key]) - Number(x.m[key])).slice(0, a.limit).map((x) => ({ name: x.label, detail: x.sub, ...pick(x.m) })),
        },
        monthly: a.include_monthly ? monthly(f, scope, flt.from, flt.to).map((m) => ({ month: m.month, billed: r2(m.billed), received: r2(m.received), costs: r2(m.costs), collection_rate_pct: m.rate != null ? r2(m.rate * 100) : null })) : undefined,
        overdue_aging: agingBuckets(items).map((b) => ({ bucket: b.label, amount: r2(b.amount), items: b.count })),
        lease_expiries_next_12m: expiryTimeline(f, scope).filter((e) => e.count).map((e) => ({ month: e.month, leases: e.leases.map((l) => `${l.lessee} (${l.property}) ${l.end}`), rent: r2(e.rent) })),
        forecast_next_6m: rentForecast(f, scope).map((x) => ({ month: x.month, billed: r2(x.due), still_to_collect: r2(x.unpaid) })),
        insights: analyticsInsights(f, flt, cur, prev, byLessee, byProperty, items).map((i) => i.text),
      };
    },
  }),

  def({
    name: "outstanding",
    title: "Who owes what",
    summary: "Overdue rent, unpaid charges and deposit shortfalls by lessee, biggest first.",
    description: "Everything owed right now, grouped by lessee: overdue rent, unpaid lessee-billed charges (water, electricity…), deposit shortfall, days since the oldest unpaid item, and contact details. Optionally filter by lessee name or minimum days overdue.",
    perm: "view_rent",
    input: z.object({
      lessee: z.string().optional().describe("Part of a lessee name"),
      min_days_overdue: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: async ({ lessee, min_days_overdue, limit }, { sb }) => {
      let rows = await outstandingByLessee(sb);
      if (lessee) rows = rows.filter((r) => r.lessee.toLowerCase().includes(lessee.toLowerCase()));
      if (min_days_overdue != null) rows = rows.filter((r) => r.daysOverdue >= min_days_overdue);
      return {
        currency: "KES",
        total_owed: r2(rows.reduce((a, r) => a + r.total, 0)),
        lessees: rows.slice(0, limit).map((r) => ({
          lessee: r.lessee, contact: r.contact, properties: r.properties,
          rent_overdue: r2(r.rent), charges_unpaid: r2(r.costs), deposit_shortfall: r2(r.deposit), total: r.total,
          oldest_due: r.oldestDue, days_overdue: r.daysOverdue,
        })),
        more: Math.max(0, rows.length - limit),
      };
    },
  }),

  def({
    name: "unpaid_items",
    title: "Unpaid items for a lessee",
    summary: "Each unpaid rent month and charge (with ids) for a lessee — use before recording a payment.",
    description: "Lists every unpaid or part-paid rent row and lessee-billed charge for a lessee, oldest first, with the id needed by record_payment / collect_in_full and the amount still owed. Includes upcoming (not yet due) months when include_upcoming is true.",
    perm: "view_rent",
    input: z.object({ lessee: z.string().min(2), include_upcoming: z.boolean().default(false) }),
    run: async ({ lessee, include_upcoming }, { sb }) => {
      const leases = await findLeaseIds(sb, lessee);
      if (!leases.length) return { error: `No lessee matches "${lessee}".` };
      const ids = leases.map((l) => l.id);
      let rq = sb.from("rent_collections").select("id, lease_id, due_date, due_month, net_amount, collected_amount, status, properties(name)").in("lease_id", ids).in("status", ["due", "partial", "overdue"]).order("due_date");
      if (!include_upcoming) rq = rq.lte("due_date", today());
      const [rent, costs] = await Promise.all([
        rq,
        sb.from("costs").select("id, lease_id, description, due_date, amount, collected_amount, collection_status").eq("payable_by_lessee", true).in("lease_id", ids).in("collection_status", ["due", "partial"]).order("due_date"),
      ]);
      const name = new Map(leases.map((l) => [l.id, l.lessee_name]));
      return {
        currency: "KES",
        lessees_matched: [...new Set(leases.map((l) => l.lessee_name))],
        rent: (rent.data ?? []).map((r: any) => ({
          kind: "rent", id: r.id, lessee: name.get(r.lease_id), property: one<any>(r.properties)?.name,
          month: String(r.due_month).slice(0, 7), due_date: r.due_date, amount: Number(r.net_amount), paid: Number(r.collected_amount),
          owed: r2(Number(r.net_amount) - Number(r.collected_amount)), overdue: r.due_date <= today(),
        })),
        charges: (costs.data ?? []).map((c: any) => ({
          kind: "cost", id: c.id, lessee: name.get(c.lease_id), description: c.description, due_date: c.due_date,
          amount: Number(c.amount), paid: Number(c.collected_amount), owed: r2(Number(c.amount) - Number(c.collected_amount)),
        })),
      };
    },
  }),

  def({
    name: "lessee_statement",
    title: "Lessee statement",
    summary: "A lessee's ledger: charges, payments and running balance, plus deposit position.",
    description: "Statement for a lessee (all their leases) or a single lease: balance brought forward, each rent charge, lessee-billed charge and payment in date order with a running balance, totals, closing balance and deposit charged/received/shortfall. Defaults to the whole tenancy.",
    perm: "view_rent",
    input: z.object({
      lessee: z.string().optional().describe("Exact or partial lessee name"),
      lease_id: z.string().uuid().optional(),
      from: ISO.optional(),
      to: ISO.optional(),
    }),
    run: async ({ lessee, lease_id, from, to }, { sb }) => {
      let scope: { leaseId: string } | { lessee: string };
      if (lease_id) scope = { leaseId: lease_id };
      else if (lessee) {
        const m = await findLeaseIds(sb, lessee);
        const names = [...new Set(m.map((l) => l.lessee_name))];
        if (!names.length) return { error: `No lessee matches "${lessee}".` };
        if (names.length > 1 && !names.some((n) => n.toLowerCase() === lessee.toLowerCase())) return { error: "Several lessees match — be more specific.", matches: names };
        scope = { lessee: names.find((n) => n.toLowerCase() === lessee.toLowerCase()) ?? names[0]! };
      } else return { error: "Give a lessee name or a lease_id." };
      const st = await buildStatement(sb, scope, { from, to });
      return st ? { currency: "KES", ...st } : { error: "Not found." };
    },
  }),

  def({
    name: "list_payments",
    title: "Payments received",
    summary: "The payment log: who paid what, when, how, with references.",
    description: "Payments received in a period (default last 3 months), newest first, with lessee, property, what it paid for, method (M-Pesa, bank, cheque, cash), reference and amount, plus totals by method and by type.",
    perm: "view_rent",
    input: z.object({
      from: ISO.optional(), to: ISO.optional(),
      lessee: z.string().optional(),
      method: z.enum(["mpesa", "bank", "cheque", "cash", "other", "adjustment", "opening"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    run: async ({ from, to, lessee, method, limit }, { sb }) => {
      const p = period(from, to);
      const leaseIds = lessee ? (await findLeaseIds(sb, lessee)).map((l) => l.id) : null;
      if (leaseIds && !leaseIds.length) return { error: `No lessee matches "${lessee}".` };
      const rows = await fetchAll<any>((f, t) => {
        let q = sb.from("payments").select("paid_on, kind, amount, method, reference, notes, leases(lessee_name), properties(name), rent_collections(due_month), costs(description)").gte("paid_on", p.from).lte("paid_on", p.to);
        if (method) q = q.eq("method", method);
        if (leaseIds) q = q.in("lease_id", leaseIds);
        return q.order("paid_on", { ascending: false }).range(f, t);
      });
      const by = (k: (r: any) => string) => Object.fromEntries([...rows.reduce((m, r) => m.set(k(r), (m.get(k(r)) ?? 0) + Number(r.amount)), new Map<string, number>())].map(([a, b]) => [a, r2(b)]));
      return {
        period: { from: p.from, to: p.to }, currency: "KES",
        total: r2(rows.reduce((a, r) => a + Number(r.amount), 0)), count: rows.length,
        by_method: by((r) => methodLabel(r.method)), by_type: by((r) => r.kind),
        payments: rows.slice(0, limit).map((r) => ({
          paid_on: r.paid_on, lessee: one<any>(r.leases)?.lessee_name, property: one<any>(r.properties)?.name,
          for: r.kind === "rent" ? `rent ${String(one<any>(r.rent_collections)?.due_month ?? "").slice(0, 7)}` : r.kind === "cost" ? one<any>(r.costs)?.description : "deposit",
          method: methodLabel(r.method), reference: r.reference, amount: Number(r.amount),
        })),
      };
    },
  }),

  def({
    name: "cash_flow_forecast",
    title: "Cash-flow forecast",
    summary: "Rent still to come in, month by month, for the next few months.",
    description: "Expected incoming rent by month for the next N months (default 6): the unpaid balance of rent rows falling due each month, plus what's already overdue.",
    perm: "view_rent",
    input: z.object({ months: z.number().int().min(1).max(12).default(6) }),
    run: async ({ months }, { sb }) => {
      const end = new Date(); end.setUTCMonth(end.getUTCMonth() + months);
      const rows = await fetchAll<any>((f, t) => sb.from("rent_collections").select("due_date, net_amount, collected_amount").in("status", ["due", "partial", "overdue"]).lte("due_date", end.toISOString().slice(0, 10)).range(f, t));
      const t0 = today();
      let overdue = 0;
      const byMonth = new Map<string, number>();
      for (const r of rows) {
        const owed = Number(r.net_amount) - Number(r.collected_amount);
        if (owed <= 0) continue;
        if (r.due_date <= t0) overdue += owed;
        else byMonth.set(r.due_date.slice(0, 7), (byMonth.get(r.due_date.slice(0, 7)) ?? 0) + owed);
      }
      return { currency: "KES", already_overdue: r2(overdue), upcoming_by_month: [...byMonth].sort().map(([month, amount]) => ({ month, amount: r2(amount) })) };
    },
  }),

  def({
    name: "expiring_leases",
    title: "Leases ending soon",
    summary: "Active leases ending within N days, with contacts and rent.",
    description: "Active leases whose end date falls within the next N days (default 60), soonest first.",
    perm: "view_leases",
    input: z.object({ within_days: z.number().int().min(1).max(365).default(60) }),
    run: async ({ within_days }, { sb }) => {
      const until = new Date(Date.now() + within_days * 86400000).toISOString().slice(0, 10);
      const { data } = await sb.from("leases").select("id, lessee_name, lessee_contact, end_date, gross_rent_monthly, properties(name, compounds(name))").eq("active", true).gte("end_date", today()).lte("end_date", until).order("end_date");
      return {
        currency: "KES",
        leases: (data ?? []).map((l: any) => ({
          lease_id: l.id, lessee: l.lessee_name, contact: l.lessee_contact, property: one<any>(l.properties)?.name,
          compound: one<any>(one<any>(l.properties)?.compounds)?.name, end_date: l.end_date,
          days_left: Math.round((Date.parse(l.end_date) - Date.parse(today())) / 86400000), rent_per_month: Number(l.gross_rent_monthly),
        })),
      };
    },
  }),

  def({
    name: "rent_roll",
    title: "Rent roll",
    summary: "Every property with its lessee, rent, size, valuation and status.",
    description: "The rent roll: every non-archived property with compound, size, valuation, service charge, current lessee, monthly rent, lease end date and whether it's vacant. Optionally filter to one compound.",
    perm: "view_properties",
    input: z.object({ compound: z.string().optional() }),
    run: async ({ compound }, { sb }) => {
      const { data } = await sb.from("properties").select("id, name, area_sqft, valuation, service_charge_monthly, compounds(name), leases(id, active, lessee_name, gross_rent_monthly, end_date)").eq("archived", false);
      let rows = (data ?? []).map((p: any) => {
        const l = (p.leases ?? []).find((x: any) => x.active);
        return {
          property_id: p.id, property: p.name, compound: one<any>(p.compounds)?.name, sqft: Number(p.area_sqft), valuation: Number(p.valuation),
          service_charge_per_month: Number(p.service_charge_monthly), lessee: l?.lessee_name ?? null, rent_per_month: l ? Number(l.gross_rent_monthly) : null,
          lease_ends: l?.end_date ?? null, status: l ? "let" : "vacant",
        };
      });
      if (compound) rows = rows.filter((r) => (r.compound ?? "").toLowerCase().includes(compound.toLowerCase()));
      rows.sort((a, b) => `${a.compound}${a.property}`.localeCompare(`${b.compound}${b.property}`, undefined, { numeric: true }));
      return {
        currency: "KES", properties: rows.length, let: rows.filter((r) => r.status === "let").length,
        monthly_rent: r2(rows.reduce((a, r) => a + (r.rent_per_month ?? 0), 0)), rows,
      };
    },
  }),

  def({
    name: "search",
    title: "Search",
    summary: "Find compounds, properties and leases by name.",
    description: "Find compounds, properties (with their current lessee) and leases whose name or lessee matches the query. Returns ids for the get_* tools.",
    perm: "view_properties",
    input: z.object({ query: z.string().min(2) }),
    run: async ({ query }, { sb, profile }) => {
      const like = `%${query}%`;
      const [c, p, l] = await Promise.all([
        has(profile, "view_compounds") ? sb.from("compounds").select("id, name, address").or(`name.ilike.${like},address.ilike.${like}`).limit(20) : Promise.resolve({ data: [] }),
        sb.from("properties").select("id, name, compounds(name), leases(lessee_name, active)").eq("archived", false).ilike("name", like).limit(30),
        has(profile, "view_leases") ? sb.from("leases").select("id, lessee_name, active, start_date, end_date, properties(name)").ilike("lessee_name", like).limit(30) : Promise.resolve({ data: [] }),
      ]);
      return {
        compounds: c.data ?? [],
        properties: (p.data ?? []).map((x: any) => ({ id: x.id, name: x.name, compound: one<any>(x.compounds)?.name, lessee: (x.leases ?? []).find((y: any) => y.active)?.lessee_name ?? null })),
        leases: (l.data ?? []).map((x: any) => ({ id: x.id, lessee: x.lessee_name, property: one<any>(x.properties)?.name, active: x.active, start_date: x.start_date, end_date: x.end_date })),
      };
    },
  }),

  def({
    name: "get_property",
    title: "Property details",
    summary: "One property: facts, current lease, recent rent and money in/out.",
    description: "Details for one property (by id, or by exact/partial name): size, valuation, service charge, current lease, the last 12 rent rows, all-time rent collected and costs.",
    perm: "view_properties",
    input: z.object({ property_id: z.string().uuid().optional(), name: z.string().optional() }),
    run: async ({ property_id, name }, { sb }) => {
      let id = property_id;
      if (!id && name) {
        const { data } = await sb.from("properties").select("id, name").ilike("name", `%${name}%`).eq("archived", false).limit(5);
        if (!data?.length) return { error: `No property matches "${name}".` };
        if (data.length > 1 && !data.some((d) => d.name.toLowerCase() === name.toLowerCase())) return { error: "Several properties match.", matches: data };
        id = (data.find((d) => d.name.toLowerCase() === name.toLowerCase()) ?? data[0]!).id;
      }
      if (!id) return { error: "Give a property_id or name." };
      const [p, summary, rent] = await Promise.all([
        sb.from("properties").select("id, name, area_sqft, valuation, service_charge_monthly, deed_url, notes, compounds(name), leases(id, active, lessee_name, lessee_contact, start_date, end_date, gross_rent_monthly, deposit_charged, deposit_collected)").eq("id", id).maybeSingle(),
        sb.from("v_property_summary").select("total_rent_collected, total_rent_due, total_costs").eq("id", id).maybeSingle(),
        sb.from("rent_collections").select("due_date, net_amount, collected_amount, status").eq("property_id", id).order("due_date", { ascending: false }).limit(12),
      ]);
      if (!p.data) return { error: "Property not found." };
      const x: any = p.data;
      return {
        currency: "KES", id: x.id, name: x.name, compound: one<any>(x.compounds)?.name, sqft: Number(x.area_sqft), valuation: Number(x.valuation),
        service_charge_per_month: Number(x.service_charge_monthly), notes: x.notes,
        current_lease: (x.leases ?? []).find((l: any) => l.active) ?? null,
        past_leases: (x.leases ?? []).filter((l: any) => !l.active).map((l: any) => ({ lease_id: l.id, lessee: l.lessee_name, start_date: l.start_date, end_date: l.end_date })),
        totals: summary.data ?? null,
        recent_rent: rent.data ?? [],
      };
    },
  }),

  def({
    name: "get_lease",
    title: "Lease details",
    summary: "One lease: terms, deposit, rent changes and what's owed.",
    description: "Details for one lease: lessee and contact, property, dates, rent, service-charge mode, deposit charged/received, rent change history, and the unpaid balance.",
    perm: "view_leases",
    input: z.object({ lease_id: z.string().uuid() }),
    run: async ({ lease_id }, { sb }) => {
      const [l, changes, rent] = await Promise.all([
        sb.from("leases").select("*, properties(name, compounds(name))").eq("id", lease_id).maybeSingle(),
        sb.from("lease_rent_changes").select("effective_date, old_amount, new_amount, reason").eq("lease_id", lease_id).order("effective_date"),
        sb.from("rent_collections").select("due_date, net_amount, collected_amount").eq("lease_id", lease_id).in("status", ["due", "partial", "overdue"]).lte("due_date", today()),
      ]);
      if (!l.data) return { error: "Lease not found." };
      const x: any = l.data;
      return {
        currency: "KES", lease_id: x.id, lessee: x.lessee_name, contact: x.lessee_contact, property: one<any>(x.properties)?.name,
        compound: one<any>(one<any>(x.properties)?.compounds)?.name, start_date: x.start_date, end_date: x.end_date, active: x.active,
        cancelled_at: x.cancelled_at, rent_per_month: Number(x.gross_rent_monthly), service_charge: x.sc_payment_mode === "lessee_direct" ? "lessee pays" : "landlord pays",
        deposit: { charged: Number(x.deposit_charged), received: Number(x.deposit_collected), shortfall: r2(Math.max(0, Number(x.deposit_charged) - Number(x.deposit_collected))) },
        rent_changes: changes.data ?? [],
        overdue_rent: r2((rent.data ?? []).reduce((a: number, r: any) => a + Number(r.net_amount) - Number(r.collected_amount), 0)),
      };
    },
  }),

  def({
    name: "costs_breakdown",
    title: "Costs breakdown",
    summary: "Owner costs by category, and lessee-billed charges, for a period.",
    description: "Costs in a period (default last 3 months): the landlord's own costs by category, and charges billed on to lessees (billed vs collected).",
    perm: "view_costs",
    input: z.object({ from: ISO.optional(), to: ISO.optional() }),
    run: async ({ from, to }, { sb }) => {
      const p = period(from, to);
      const [own, billed] = await Promise.all([
        fetchAll<any>((f, t) => sb.from("cost_line_items").select("category, amount, costs!inner(incurred_on, payable_by_lessee)").gte("costs.incurred_on", p.from).lte("costs.incurred_on", p.to).eq("costs.payable_by_lessee", false).range(f, t)),
        fetchAll<any>((f, t) => sb.from("costs").select("amount, collected_amount").eq("payable_by_lessee", true).gte("incurred_on", p.from).lte("incurred_on", p.to).range(f, t)),
      ]);
      const cats = new Map<string, number>();
      for (const li of own) cats.set(li.category, (cats.get(li.category) ?? 0) + Number(li.amount));
      return {
        period: { from: p.from, to: p.to }, currency: "KES",
        owner_costs_total: r2([...cats.values()].reduce((a, b) => a + b, 0)),
        owner_costs_by_category: [...cats].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount: r2(amount) })),
        billed_to_lessees: { billed: r2(billed.reduce((a, c) => a + Number(c.amount), 0)), collected: r2(billed.reduce((a, c) => a + Number(c.collected_amount), 0)), count: billed.length },
      };
    },
  }),

  def({
    name: "service_charges_summary",
    title: "Service charges",
    summary: "Service charges by status (pending, paid, skipped, lessee-direct).",
    description: "Service charges owed to compound managements: totals and counts by status, and the pending ones oldest first.",
    perm: "view_service_charges",
    input: z.object({ limit: z.number().int().min(1).max(200).default(30) }),
    run: async ({ limit }, { sb }) => {
      const rows = await fetchAll<any>((f, t) => sb.from("service_charges").select("due_month, amount, status, properties(name)").order("due_month").range(f, t));
      const by = new Map<string, { count: number; amount: number }>();
      for (const r of rows) { const b = by.get(r.status) ?? { count: 0, amount: 0 }; b.count++; b.amount += Number(r.amount); by.set(r.status, b); }
      return {
        currency: "KES",
        by_status: Object.fromEntries([...by].map(([k, v]) => [k, { count: v.count, amount: r2(v.amount) }])),
        pending: rows.filter((r) => r.status === "pending").slice(0, limit).map((r) => ({ month: String(r.due_month).slice(0, 7), property: one<any>(r.properties)?.name, amount: Number(r.amount) })),
      };
    },
  }),

  def({
    name: "recent_changes",
    title: "Recent changes",
    summary: "The audit trail: who changed what, and when.",
    description: "Recent entries from the audit trail (admins only): who created, updated or deleted which record, with the fields that changed.",
    perm: "manage_users",
    input: z.object({ limit: z.number().int().min(1).max(200).default(50), entity: z.string().optional().describe("Table, e.g. payments, leases, rent_collections") }),
    run: async ({ limit, entity }, { sb }) => {
      let q = sb.from("audit_log").select("at, actor_email, action, entity, label, changes").order("at", { ascending: false }).limit(limit);
      if (entity) q = q.eq("entity", entity);
      const { data } = await q;
      return { changes: data ?? [] };
    },
  }),

  // ── writes ────────────────────────────────────────────────────────────────
  def({
    name: "record_payment",
    title: "Record a payment",
    summary: "Record money received against one rent month, charge or deposit (part-payments allowed).",
    description: "Record a payment against one item: kind 'rent' (target_id = rent row id from unpaid_items), 'cost' (charge id) or 'deposit' (target_id = lease id). Amount may be less than owed (part-payment) but not more. Confirm the details with the user before calling.",
    perm: "mark_rent",
    writes: true,
    input: z.object({
      kind: z.enum(["rent", "cost", "deposit"]),
      target_id: z.string().uuid(),
      amount: z.number().positive(),
      paid_on: ISO.optional().describe("Date received (default today)"),
      method: z.enum(PAYMENT_METHODS.map((m) => m.value) as [string, ...string[]]),
      reference: z.string().max(60).optional().describe("M-Pesa code, cheque number…"),
      notes: z.string().max(300).optional(),
    }),
    run: async (a, { sb }) => {
      const { data, error } = await sb.rpc("record_payment", {
        p_kind: a.kind, p_target: a.target_id, p_amount: a.amount, p_paid_on: a.paid_on ?? today(),
        p_method: a.method, p_reference: a.reference ?? null, p_notes: a.notes ?? "Recorded via MCP",
      });
      if (error) return { error: error.message };
      revalidateApp();
      return { recorded: true, ...(data as object) };
    },
  }),

  def({
    name: "collect_in_full",
    title: "Collect items in full",
    summary: "Mark several rent months / charges as fully paid under one payment.",
    description: "Collect the full remaining balance of several rent rows and/or charges at once (e.g. one M-Pesa payment covering three months). Ids come from unpaid_items. Confirm with the user before calling.",
    perm: "mark_rent",
    writes: true,
    input: z.object({
      rent_ids: z.array(z.string().uuid()).max(200).default([]),
      cost_ids: z.array(z.string().uuid()).max(200).default([]),
      paid_on: ISO.optional(),
      method: z.enum(PAYMENT_METHODS.map((m) => m.value) as [string, ...string[]]),
      reference: z.string().max(60).optional(),
    }),
    run: async ({ rent_ids, cost_ids, paid_on, method, reference }, { sb }) => {
      if (!rent_ids.length && !cost_ids.length) return { error: "Nothing to collect." };
      const [rent, costs] = await Promise.all([
        rent_ids.length ? sb.from("rent_collections").select("id, net_amount, collected_amount").in("id", rent_ids) : Promise.resolve({ data: [] as any[] }),
        cost_ids.length ? sb.from("costs").select("id, amount, collected_amount").in("id", cost_ids) : Promise.resolve({ data: [] as any[] }),
      ]);
      const items = [
        ...(rent.data ?? []).map((r: any) => ({ kind: "rent", id: r.id, owed: Number(r.net_amount) - Number(r.collected_amount) })),
        ...(costs.data ?? []).map((c: any) => ({ kind: "cost", id: c.id, owed: Number(c.amount) - Number(c.collected_amount) })),
      ];
      const results = [];
      let total = 0;
      for (const it of items) {
        if (it.owed <= 0) { results.push({ ...it, skipped: "already paid" }); continue; }
        const { error } = await sb.rpc("record_payment", {
          p_kind: it.kind, p_target: it.id, p_amount: r2(it.owed), p_paid_on: paid_on ?? today(),
          p_method: method, p_reference: reference ?? null, p_notes: "Collected in full via MCP",
        });
        if (error) results.push({ ...it, error: error.message });
        else { results.push({ ...it, recorded: r2(it.owed) }); total += it.owed; }
      }
      revalidateApp();
      return { currency: "KES", total_recorded: r2(total), results };
    },
  }),

  def({
    name: "log_reminder",
    title: "Log a reminder",
    summary: "Record that a lessee was reminded (WhatsApp, SMS, email or call).",
    description: "Add an entry to the reminder log after the user has contacted a lessee. Does not send anything itself.",
    perm: "mark_rent",
    writes: true,
    input: z.object({
      lessee: z.string().min(2),
      channel: z.enum(["whatsapp", "sms", "email", "call", "other"]),
      kind: z.enum(["overdue", "expiry", "deposit", "other"]).default("overdue"),
      message: z.string().max(2000).default(""),
      amount: z.number().optional(),
    }),
    run: async ({ lessee, channel, kind, message, amount }, { sb, profile }) => {
      const m = await findLeaseIds(sb, lessee);
      const exact = m.find((l) => l.lessee_name.toLowerCase() === lessee.toLowerCase()) ?? m[0];
      if (!exact) return { error: `No lessee matches "${lessee}".` };
      const { error } = await sb.from("reminders").insert({ lessee_name: exact.lessee_name, lease_id: exact.id, channel, kind, message, amount: amount ?? null, sent_by: profile.id });
      return error ? { error: error.message } : { logged: true, lessee: exact.lessee_name };
    },
  }),
];

/** Name, one-line summary and whether it writes — for the API keys page. */
export const MCP_TOOL_CATALOG = TOOLS.map((t) => ({ name: t.name, summary: t.summary, writes: Boolean(t.writes), perm: t.perm }));
