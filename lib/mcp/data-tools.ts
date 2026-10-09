import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { methodLabel } from "@/lib/payment-methods";
import { def, ISO, num, one, r2 } from "./shared";

/**
 * Raw-data tools: every record type, filterable and paged, with ids and names
 * resolved, so an MCP client can pull exactly the rows it needs and do its own
 * analysis. Each list returns { total, returned, offset, next_offset, rows }:
 * keep calling with offset = next_offset until it is null to get everything.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);

const paging = {
  limit: z.number().int().min(1).max(1000).default(200).describe("Rows per call (max 1000)"),
  offset: z.number().int().min(0).default(0).describe("Skip this many rows; use next_offset from the previous call"),
};
const scope = {
  compound: z.string().optional().describe("Compound id or (partial) name"),
  property: z.string().optional().describe("Property id or (partial) name"),
};
const page = <T,>(rows: T[], total: number, offset: number) => ({
  total,
  returned: rows.length,
  offset,
  next_offset: offset + rows.length < total ? offset + rows.length : null,
  rows,
});
const slice = <T,>(all: T[], offset: number, limit: number) => page(all.slice(offset, offset + limit), all.length, offset);

/** Property ids matching a compound and/or property filter; null when neither is given. */
async function propertyIds(sb: SupabaseClient, f: { compound?: string; property?: string }): Promise<string[] | null | { error: string }> {
  if (!f.compound && !f.property) return null;
  let q = sb.from("properties").select("id, name, compound_id, compounds!inner(id, name)");
  if (f.compound) q = UUID.test(f.compound) ? q.eq("compound_id", f.compound) : q.ilike("compounds.name", `%${f.compound}%`);
  if (f.property) q = UUID.test(f.property) ? q.eq("id", f.property) : q.ilike("name", `%${f.property}%`);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const ids = (data ?? []).map((p: any) => p.id as string);
  if (!ids.length) return { error: `No property matches${f.compound ? ` compound "${f.compound}"` : ""}${f.property ? ` property "${f.property}"` : ""}.` };
  return ids;
}

/** Lease ids for a lessee name / lease id / property set; null when unfiltered. */
async function leaseIds(sb: SupabaseClient, f: { lessee?: string; lease_id?: string; props?: string[] | null }): Promise<string[] | null | { error: string }> {
  if (!f.lessee && !f.lease_id && !f.props) return null;
  let q = sb.from("leases").select("id");
  if (f.lease_id) q = q.eq("id", f.lease_id);
  if (f.lessee) q = q.ilike("lessee_name", `%${f.lessee}%`);
  if (f.props) q = q.in("property_id", f.props);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const ids = (data ?? []).map((l: any) => l.id as string);
  if (!ids.length) return { error: "No lease matches those filters." };
  return ids;
}

async function peopleNames(sb: SupabaseClient) {
  const { data } = await sb.from("people").select("id, full_name, email");
  return new Map((data ?? []).map((p: any) => [p.id as string, (p.full_name || p.email) as string]));
}

const isErr = (v: unknown): v is { error: string } => Boolean(v && typeof v === "object" && "error" in (v as object));

// ─── Data dictionary ────────────────────────────────────────────────────────

const DICTIONARY = {
  currency: "All amounts are Kenyan shillings (KES). Dates are YYYY-MM-DD; timestamps are ISO 8601 UTC.",
  how_to_fetch_everything: "List tools page their results: call again with offset = next_offset until next_offset is null. Filters narrow on the server, so prefer them to fetching everything.",
  entities: {
    compound: { tool: "list_compounds / get_compound", what: "A site or building that groups properties (e.g. a godown park or office block).", fields: { id: "uuid", name: "text", address: "text|null" } },
    property: {
      tool: "list_properties / get_property",
      what: "A lettable unit (godown, office, showroom, land) inside a compound.",
      fields: { area_sqft: "size", valuation: "current value (for yield)", service_charge_monthly: "what the compound management charges us per month for this unit", archived: "no longer in the portfolio", current_lease: "the active lease, or null when vacant" },
    },
    lease: {
      tool: "list_leases / get_lease",
      what: "An agreement letting one property to one lessee (tenant) between start_date and end_date. A lessee (company) can hold several leases; lessee_name is the grouping key.",
      fields: {
        gross_rent_monthly: "rent per month before any service-charge deduction",
        sc_payment_mode: "who covers the service charge — we_pay: we pay it, lessee pays gross rent; we_collect: lessee pays gross rent minus the SC to us and we pay the SC; lessee_direct: lessee pays the management directly",
        deposit_charged: "deposit the lessee owes", deposit_collected: "deposit received so far",
        status: "active, ended (past end date / closed) or cancelled (terminated early; see cancelled_at, cancelled_reason)",
      },
    },
    rent_row: {
      tool: "list_rent_rows / unpaid_items",
      what: "One month's rent for one lease. Created ahead of time for the lease term.",
      fields: {
        due_month: "first day of the rent month", due_date: "when payment is due",
        gross_amount: "rent for the month", service_charge_deduction: "SC deducted (we_collect leases)", net_amount: "what the lessee owes = gross − deduction",
        collected_amount: "received so far", remaining: "net_amount − collected_amount",
        status: "due (nothing paid), partial (part paid), collected (paid in full)", overdue: "true when unpaid and due_date is before today",
      },
    },
    payment: {
      tool: "list_payments",
      what: "Money received. kind = rent (against a rent row), cost (against a lessee charge) or deposit (against a lease). Rent rows' collected_amount is the sum of their payments.",
      fields: { method: "mpesa, bank, cheque, cash, other; adjustment = correction; opening = balance imported from before the payment log existed", reference: "M-Pesa code / cheque no.", recorded_by: "who entered it" },
    },
    cost: {
      tool: "list_costs / costs_breakdown",
      what: "Money spent or billed. payable_by_lessee=false: the owner's own expense, split across properties (allocations, by sqft when shared). payable_by_lessee=true: a charge billed to a lessee (water, electricity…) that they must pay back; collected_amount / collection_status track that.",
      fields: { line_items: "category breakdown of the amount", allocations: "property shares of an owner cost", incurred_on: "date of the expense", due_date: "when a lessee charge is due" },
    },
    service_charge: {
      tool: "list_service_charges / service_charges_summary",
      what: "What we owe a compound's management each month for a property. status: pending (to pay), paid, skipped, lessee_direct (lessee pays them directly).",
    },
    reminder: { tool: "list_reminders / log_reminder", what: "A log of reminders staff sent lessees (overdue rent, lease expiry, deposit). Variaka does not send messages itself." },
    rent_change: { tool: "list_rent_changes", what: "History of rent increases/decreases on a lease: effective_date, old_amount, new_amount, reason." },
  },
  derived_measures: {
    collection_rate: "rent received ÷ rent billed (net) for rent rows due in the period",
    outstanding: "sum of remaining on rent rows due before today + unpaid lessee charges due before today (+ deposit shortfall if relevant)",
    occupancy: "properties with an active lease ÷ non-archived properties",
    yield: "net income (rent received − owner costs) annualised ÷ valuation",
  },
  summary_tools: "portfolio_summary, analyze, outstanding, lessee_statement, cash_flow_forecast, rent_roll and costs_breakdown return ready-made aggregates when they fit the question; the list_* tools return the underlying records.",
};

export const DATA_TOOLS = [
  def({
    name: "describe_data",
    title: "Data dictionary",
    summary: "What each record type and field means, and how to page through data.",
    description: "Explains Variaka's data model: compounds, properties, leases, rent rows, payments, costs/charges, service charges, reminders and rent changes — their fields, statuses, how amounts relate (gross, net, collected, remaining), how derived measures are defined, and which tool returns which records. Call this first if you are unsure how to answer a question from the data.",
    perm: null,
    input: z.object({}),
    run: async () => DICTIONARY,
  }),

  def({
    name: "list_compounds",
    title: "List compounds",
    summary: "Every compound with its property count, size, valuation and occupancy.",
    description: "All compounds with id, name, address, number of (non-archived) properties, how many are let, total sqft and total valuation.",
    perm: "view_compounds",
    input: z.object({ search: z.string().optional().describe("Partial name"), ...paging }),
    run: async ({ search, limit, offset }, { sb }) => {
      let q = sb.from("compounds").select("id, name, address, created_at, properties(id, area_sqft, valuation, archived, leases(active))").order("name");
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, error } = await q;
      if (error) return { error: error.message };
      const rows = (data ?? []).map((c: any) => {
        const props = (c.properties ?? []).filter((p: any) => !p.archived);
        return {
          id: c.id, name: c.name, address: c.address,
          properties: props.length,
          let: props.filter((p: any) => (p.leases ?? []).some((l: any) => l.active)).length,
          sqft: r2(props.reduce((a: number, p: any) => a + Number(p.area_sqft || 0), 0)),
          valuation: r2(props.reduce((a: number, p: any) => a + Number(p.valuation || 0), 0)),
        };
      });
      return { currency: "KES", ...slice(rows, offset, limit) };
    },
  }),

  def({
    name: "get_compound",
    title: "Compound details",
    summary: "One compound with every property, its lessee and rent.",
    description: "One compound (by id or partial name) with each property's size, valuation, service charge, current lessee, rent and lease end date.",
    perm: "view_compounds",
    input: z.object({ compound: z.string().describe("Compound id or (partial) name") }),
    run: async ({ compound }, { sb }) => {
      let q = sb.from("compounds").select("id, name, address, properties(id, name, area_sqft, valuation, service_charge_monthly, archived, leases(id, lessee_name, gross_rent_monthly, end_date, active))");
      q = UUID.test(compound) ? q.eq("id", compound) : q.ilike("name", `%${compound}%`);
      const { data, error } = await q.limit(5);
      if (error) return { error: error.message };
      if (!data?.length) return { error: `No compound matches "${compound}".` };
      if (data.length > 1) return { error: "Several compounds match — be more specific or use an id.", matches: data.map((c: any) => ({ id: c.id, name: c.name })) };
      const c: any = data[0];
      const props = (c.properties ?? []).filter((p: any) => !p.archived).map((p: any) => {
        const l = (p.leases ?? []).find((x: any) => x.active);
        return { id: p.id, name: p.name, sqft: num(p.area_sqft), valuation: num(p.valuation), service_charge_monthly: num(p.service_charge_monthly), lease_id: l?.id ?? null, lessee: l?.lessee_name ?? null, rent_monthly: l ? num(l.gross_rent_monthly) : null, lease_end: l?.end_date ?? null };
      }).sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { currency: "KES", id: c.id, name: c.name, address: c.address, properties: props };
    },
  }),

  def({
    name: "list_properties",
    title: "List properties",
    summary: "Properties with size, valuation, service charge and current lease.",
    description: "Properties (non-archived by default) with id, compound, sqft, valuation, monthly service charge, and the current lease (id, lessee, rent, end date) or null when vacant. Filter by compound, name, vacancy.",
    perm: "view_properties",
    input: z.object({
      compound: scope.compound, search: z.string().optional().describe("Partial property name"),
      vacant: z.boolean().optional().describe("true = only vacant, false = only let"),
      include_archived: z.boolean().default(false),
      ...paging,
    }),
    run: async ({ compound, search, vacant, include_archived, limit, offset }, { sb }) => {
      const props = await propertyIds(sb, { compound });
      if (isErr(props)) return props;
      const all = await fetchAll<any>((f, t) => {
        let q = sb.from("properties").select("id, name, compound_id, area_sqft, valuation, service_charge_monthly, service_charge_start_date, archived, notes, created_at, compounds(name), leases(id, lessee_name, gross_rent_monthly, start_date, end_date, sc_payment_mode, active)");
        if (!include_archived) q = q.eq("archived", false);
        if (props) q = q.in("id", props);
        if (search) q = q.ilike("name", `%${search}%`);
        return q.order("name").range(f, t);
      });
      const rows = all.map((p) => {
        const l = (p.leases ?? []).find((x: any) => x.active);
        return {
          id: p.id, name: p.name, compound_id: p.compound_id, compound: one<any>(p.compounds)?.name ?? null,
          sqft: num(p.area_sqft), valuation: num(p.valuation), service_charge_monthly: num(p.service_charge_monthly), service_charge_start_date: p.service_charge_start_date,
          archived: p.archived, notes: p.notes,
          current_lease: l ? { id: l.id, lessee: l.lessee_name, rent_monthly: num(l.gross_rent_monthly), start_date: l.start_date, end_date: l.end_date, sc_payment_mode: l.sc_payment_mode } : null,
        };
      }).filter((p) => vacant == null || (vacant ? !p.current_lease : !!p.current_lease));
      return { currency: "KES", ...slice(rows, offset, limit) };
    },
  }),

  def({
    name: "list_leases",
    title: "List leases",
    summary: "Leases with lessee, property, dates, rent, service-charge mode and deposit.",
    description: "Leases with id, lessee name and contact, property and compound, start/end dates, monthly rent, service-charge mode, deposit charged/collected and status (active, ended, cancelled). Filter by status, lessee, compound, property, and start/end date ranges (e.g. ends_to to find leases ending soon).",
    perm: "view_leases",
    input: z.object({
      status: z.enum(["active", "ended", "cancelled", "all"]).default("active"),
      lessee: z.string().optional().describe("Partial lessee name"),
      ...scope,
      starts_from: ISO.optional(), starts_to: ISO.optional(), ends_from: ISO.optional(), ends_to: ISO.optional(),
      ...paging,
    }),
    run: async (a, { sb }) => {
      const props = await propertyIds(sb, a);
      if (isErr(props)) return props;
      let q = sb.from("leases").select("id, lessee_name, lessee_contact, property_id, start_date, end_date, gross_rent_monthly, sc_payment_mode, deposit_charged, deposit_collected, active, cancelled_at, cancelled_reason, lessee_doc_url, created_at, properties(name, compounds(name))", { count: "exact" });
      if (a.status === "active") q = q.eq("active", true);
      if (a.status === "ended") q = q.eq("active", false).is("cancelled_at", null);
      if (a.status === "cancelled") q = q.not("cancelled_at", "is", null);
      if (a.lessee) q = q.ilike("lessee_name", `%${a.lessee}%`);
      if (props) q = q.in("property_id", props);
      if (a.starts_from) q = q.gte("start_date", a.starts_from);
      if (a.starts_to) q = q.lte("start_date", a.starts_to);
      if (a.ends_from) q = q.gte("end_date", a.ends_from);
      if (a.ends_to) q = q.lte("end_date", a.ends_to);
      const { data, count, error } = await q.order("lessee_name").order("start_date").range(a.offset, a.offset + a.limit - 1);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((l: any) => {
        const p = one<any>(l.properties);
        return {
          id: l.id, lessee: l.lessee_name, contact: l.lessee_contact, property_id: l.property_id, property: p?.name ?? null, compound: one<any>(p?.compounds)?.name ?? null,
          start_date: l.start_date, end_date: l.end_date, rent_monthly: num(l.gross_rent_monthly), sc_payment_mode: l.sc_payment_mode,
          deposit_charged: num(l.deposit_charged), deposit_collected: num(l.deposit_collected),
          status: l.cancelled_at ? "cancelled" : l.active ? "active" : "ended", cancelled_at: l.cancelled_at, cancelled_reason: l.cancelled_reason,
          documents_url: l.lessee_doc_url,
        };
      });
      return { currency: "KES", ...page(rows, count ?? rows.length, a.offset) };
    },
  }),

  def({
    name: "list_rent_rows",
    title: "List rent rows",
    summary: "Monthly rent rows: billed, collected, remaining, status, overdue.",
    description: "Monthly rent rows with id, lease and lessee, property and compound, due month and date, gross, service-charge deduction, net owed, collected, remaining, status (due/partial/collected) and whether overdue. Filter by lessee, lease, compound, property, status (incl. 'overdue' and 'unpaid') and due-date range. Ordered by due date.",
    perm: "view_rent",
    input: z.object({
      lessee: z.string().optional(), lease_id: z.string().uuid().optional(), ...scope,
      status: z.enum(["due", "partial", "collected", "unpaid", "overdue", "all"]).default("all").describe("unpaid = due or partial; overdue = unpaid and past due date"),
      due_from: ISO.optional(), due_to: ISO.optional(),
      newest_first: z.boolean().default(false),
      ...paging,
    }),
    run: async (a, { sb }) => {
      const props = await propertyIds(sb, a);
      if (isErr(props)) return props;
      const leases = await leaseIds(sb, { lessee: a.lessee, lease_id: a.lease_id });
      if (isErr(leases)) return leases;
      const t = today();
      let q = sb.from("rent_collections").select("id, lease_id, property_id, due_month, due_date, gross_amount, service_charge_deduction, net_amount, collected_amount, status, collected_at, notes, leases(lessee_name), properties(name, compounds(name))", { count: "exact" });
      if (leases) q = q.in("lease_id", leases);
      if (props) q = q.in("property_id", props);
      if (a.status === "due" || a.status === "partial" || a.status === "collected") q = q.eq("status", a.status);
      if (a.status === "unpaid" || a.status === "overdue") q = q.in("status", ["due", "partial"]);
      if (a.status === "overdue") q = q.lt("due_date", t);
      if (a.due_from) q = q.gte("due_date", a.due_from);
      if (a.due_to) q = q.lte("due_date", a.due_to);
      const { data, count, error } = await q.order("due_date", { ascending: !a.newest_first }).range(a.offset, a.offset + a.limit - 1);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((r: any) => {
        const p = one<any>(r.properties);
        const remaining = r2(Number(r.net_amount || 0) - Number(r.collected_amount || 0));
        return {
          id: r.id, lease_id: r.lease_id, lessee: one<any>(r.leases)?.lessee_name ?? null, property_id: r.property_id, property: p?.name ?? null, compound: one<any>(p?.compounds)?.name ?? null,
          due_month: r.due_month, due_date: r.due_date, gross: num(r.gross_amount), sc_deduction: num(r.service_charge_deduction), net: num(r.net_amount),
          collected: num(r.collected_amount), remaining, status: r.status, overdue: r.status !== "collected" && remaining > 0 && r.due_date < t,
          last_collected_at: r.collected_at, notes: r.notes,
        };
      });
      return { currency: "KES", ...page(rows, count ?? rows.length, a.offset) };
    },
  }),

  def({
    name: "list_costs",
    title: "List costs and charges",
    summary: "Owner costs and lessee charges with line items and property splits.",
    description: "Cost records with id, description, amount, date, line items (category, amount) and — for owner costs — the property allocations; for lessee charges, the lessee, due date, collected amount and status. kind: 'owner' (our expenses), 'lessee_charge' (billed to lessees) or 'all'. Filter by date range (incurred_on, default last 12 months), category, lessee, compound, property.",
    perm: "view_costs",
    input: z.object({
      kind: z.enum(["owner", "lessee_charge", "all"]).default("all"),
      from: ISO.optional(), to: ISO.optional(),
      category: z.string().optional().describe("Line-item category, e.g. water, electricity, maintenance"),
      lessee: z.string().optional(), ...scope,
      ...paging,
    }),
    run: async (a, { sb }) => {
      const to = a.to ?? today();
      const from = a.from ?? new Date(Date.parse(to) - 365 * 86400000).toISOString().slice(0, 10);
      const props = await propertyIds(sb, a);
      if (isErr(props)) return props;
      const all = await fetchAll<any>((f, t) => {
        let q = sb.from("costs").select("id, description, amount, incurred_on, due_date, payable_by_lessee, lease_id, collected_amount, collection_status, collected_at, notes, cost_line_items(category, amount), cost_allocations(property_id, allocated_amount, properties(name, compounds(name))), leases(lessee_name, property_id, properties(name))").gte("incurred_on", from).lte("incurred_on", to);
        if (a.kind !== "all") q = q.eq("payable_by_lessee", a.kind === "lessee_charge");
        return q.order("incurred_on", { ascending: false }).range(f, t);
      });
      const propSet = props ? new Set(props) : null;
      const cat = a.category?.toLowerCase();
      const lessee = a.lessee?.toLowerCase();
      const rows = all.filter((c) => {
        const lease = one<any>(c.leases);
        if (cat && !(c.cost_line_items ?? []).some((li: any) => String(li.category).toLowerCase().includes(cat))) return false;
        if (lessee && !String(lease?.lessee_name ?? "").toLowerCase().includes(lessee)) return false;
        if (propSet) {
          const hit = c.payable_by_lessee ? propSet.has(lease?.property_id) : (c.cost_allocations ?? []).some((x: any) => propSet.has(x.property_id));
          if (!hit) return false;
        }
        return true;
      }).map((c) => {
        const lease = one<any>(c.leases);
        return {
          id: c.id, kind: c.payable_by_lessee ? "lessee_charge" : "owner", description: c.description, amount: num(c.amount), incurred_on: c.incurred_on,
          line_items: (c.cost_line_items ?? []).map((li: any) => ({ category: li.category, amount: num(li.amount) })),
          ...(c.payable_by_lessee
            ? { lease_id: c.lease_id, lessee: lease?.lessee_name ?? null, property: one<any>(lease?.properties)?.name ?? null, due_date: c.due_date, collected: num(c.collected_amount), remaining: r2(Number(c.amount || 0) - Number(c.collected_amount || 0)), status: c.collection_status ?? "due", last_collected_at: c.collected_at }
            : { allocations: (c.cost_allocations ?? []).map((x: any) => { const p = one<any>(x.properties); return { property_id: x.property_id, property: p?.name ?? null, compound: one<any>(p?.compounds)?.name ?? null, amount: num(x.allocated_amount) }; }) }),
          notes: c.notes,
        };
      });
      return { currency: "KES", period: { from, to }, ...slice(rows, a.offset, a.limit) };
    },
  }),

  def({
    name: "list_service_charges",
    title: "List service charges",
    summary: "Monthly service charges owed to compound managements, by status.",
    description: "Service-charge rows (what we owe a compound's management per property per month) with id, property, compound, month, amount, status (pending, paid, skipped, lessee_direct) and paid date. Filter by status, month range, compound, property.",
    perm: "view_service_charges",
    input: z.object({
      status: z.enum(["pending", "paid", "skipped", "lessee_direct", "all"]).default("all"),
      from: ISO.optional().describe("Earliest due month"), to: ISO.optional().describe("Latest due month"),
      ...scope, ...paging,
    }),
    run: async (a, { sb }) => {
      const props = await propertyIds(sb, a);
      if (isErr(props)) return props;
      let q = sb.from("service_charges").select("id, property_id, due_month, amount, status, paid_at, notes, properties(name, compounds(name))", { count: "exact" });
      if (a.status !== "all") q = q.eq("status", a.status);
      if (props) q = q.in("property_id", props);
      if (a.from) q = q.gte("due_month", a.from);
      if (a.to) q = q.lte("due_month", a.to);
      const { data, count, error } = await q.order("due_month").order("property_id").range(a.offset, a.offset + a.limit - 1);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((s: any) => {
        const p = one<any>(s.properties);
        return { id: s.id, property_id: s.property_id, property: p?.name ?? null, compound: one<any>(p?.compounds)?.name ?? null, due_month: s.due_month, amount: num(s.amount), status: s.status, paid_at: s.paid_at, notes: s.notes };
      });
      return { currency: "KES", ...page(rows, count ?? rows.length, a.offset) };
    },
  }),

  def({
    name: "list_reminders",
    title: "List reminders",
    summary: "The log of reminders staff sent to lessees.",
    description: "Reminders staff logged after contacting lessees: when, lessee, lease, kind (overdue, expiry, deposit, other), channel, amount, message and who sent it. Filter by lessee, kind, channel and date range.",
    perm: "view_rent",
    input: z.object({
      lessee: z.string().optional(),
      kind: z.enum(["overdue", "expiry", "deposit", "other"]).optional(),
      channel: z.enum(["whatsapp", "sms", "email", "call", "other"]).optional(),
      from: ISO.optional(), to: ISO.optional(),
      ...paging,
    }),
    run: async (a, { sb }) => {
      let q = sb.from("reminders").select("id, lease_id, lessee_name, kind, channel, amount, message, sent_by, sent_at", { count: "exact" });
      if (a.lessee) q = q.ilike("lessee_name", `%${a.lessee}%`);
      if (a.kind) q = q.eq("kind", a.kind);
      if (a.channel) q = q.eq("channel", a.channel);
      if (a.from) q = q.gte("sent_at", a.from);
      if (a.to) q = q.lte("sent_at", `${a.to}T23:59:59Z`);
      const [{ data, count, error }, who] = await Promise.all([q.order("sent_at", { ascending: false }).range(a.offset, a.offset + a.limit - 1), peopleNames(sb)]);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((r: any) => ({ id: r.id, sent_at: r.sent_at, lessee: r.lessee_name, lease_id: r.lease_id, kind: r.kind, channel: r.channel, amount: num(r.amount), message: r.message, sent_by: r.sent_by ? who.get(r.sent_by) ?? null : null }));
      return { currency: "KES", ...page(rows, count ?? rows.length, a.offset) };
    },
  }),

  def({
    name: "list_rent_changes",
    title: "List rent changes",
    summary: "History of rent increases and decreases on leases.",
    description: "Rent changes on leases: lease, lessee, property, effective date, old and new monthly rent, change %, reason and who made it. Filter by lessee, lease and effective-date range.",
    perm: "view_leases",
    input: z.object({ lessee: z.string().optional(), lease_id: z.string().uuid().optional(), from: ISO.optional(), to: ISO.optional(), ...paging }),
    run: async (a, { sb }) => {
      const leases = await leaseIds(sb, { lessee: a.lessee, lease_id: a.lease_id });
      if (isErr(leases)) return leases;
      let q = sb.from("lease_rent_changes").select("id, lease_id, effective_date, old_amount, new_amount, reason, changed_by, created_at, leases(lessee_name, properties(name))", { count: "exact" });
      if (leases) q = q.in("lease_id", leases);
      if (a.from) q = q.gte("effective_date", a.from);
      if (a.to) q = q.lte("effective_date", a.to);
      const [{ data, count, error }, who] = await Promise.all([q.order("effective_date", { ascending: false }).range(a.offset, a.offset + a.limit - 1), peopleNames(sb)]);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((c: any) => {
        const l = one<any>(c.leases);
        const o = Number(c.old_amount || 0), n = Number(c.new_amount || 0);
        return { id: c.id, lease_id: c.lease_id, lessee: l?.lessee_name ?? null, property: one<any>(l?.properties)?.name ?? null, effective_date: c.effective_date, old_rent: o, new_rent: n, change_pct: o > 0 ? r2(((n - o) / o) * 100) : null, reason: c.reason, changed_by: c.changed_by ? who.get(c.changed_by) ?? null : null };
      });
      return { currency: "KES", ...page(rows, count ?? rows.length, a.offset) };
    },
  }),
];

/** Payment log rows with ids, for list_payments. */
export function paymentRow(r: any, who: Map<string, string>) {
  return {
    id: r.id, paid_on: r.paid_on, kind: r.kind, amount: Number(r.amount),
    lease_id: r.lease_id, lessee: one<any>(r.leases)?.lessee_name ?? null,
    property_id: r.property_id, property: one<any>(r.properties)?.name ?? null,
    rent_row_id: r.rent_collection_id ?? null, cost_id: r.cost_id ?? null,
    for: r.kind === "rent" ? `rent ${String(one<any>(r.rent_collections)?.due_month ?? "").slice(0, 7)}` : r.kind === "cost" ? one<any>(r.costs)?.description ?? null : "deposit",
    method: methodLabel(r.method), method_code: r.method, reference: r.reference, notes: r.notes,
    recorded_by: r.recorded_by ? who.get(r.recorded_by) ?? null : null,
  };
}
export { peopleNames };
