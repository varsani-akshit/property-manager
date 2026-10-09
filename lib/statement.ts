import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { methodLabel } from "./payment-methods";

/**
 * A lessee's statement: what they were charged (rent and lessee-billed costs)
 * and what they paid, in date order with a running balance, plus their deposit
 * position. One builder serves the statement page, its CSV/print export and the
 * MCP `lessee_statement` tool, so every view agrees.
 *
 * Scope is either one lease or every lease held under a lessee name.
 */

export type StatementScope = { leaseId: string } | { lessee: string };

export type StatementLine = {
  date: string;              // yyyy-mm-dd
  kind: "rent" | "cost" | "payment";
  description: string;
  property: string;
  reference: string | null;
  charge: number;            // amount billed (0 for payments)
  payment: number;           // amount received (0 for charges; negative for corrections)
  balance: number;           // running balance after this line
};

export type Statement = {
  lessee: string;
  contact: string | null;
  leases: { id: string; property: string; compound: string; start_date: string; end_date: string; active: boolean; rent: number }[];
  from: string;
  to: string;
  opening: number;           // balance brought forward from before `from`
  charges: number;
  payments: number;
  closing: number;
  lines: StatementLine[];
  deposit: { charged: number; received: number; shortfall: number };
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export async function buildStatement(
  sb: SupabaseClient,
  scope: StatementScope,
  range: { from?: string; to?: string } = {}
): Promise<Statement | null> {
  // 1. Leases in scope
  let lq = sb
    .from("leases")
    .select("id, lessee_name, lessee_contact, start_date, end_date, active, gross_rent_monthly, deposit_charged, deposit_amount, deposit_collected, properties(name, compounds(name))")
    .order("start_date");
  lq = "leaseId" in scope ? lq.eq("id", scope.leaseId) : lq.eq("lessee_name", scope.lessee);
  const { data: leaseRows, error } = await lq;
  if (error) throw new Error(error.message);
  if (!leaseRows?.length) return null;

  const leases = (leaseRows as any[]).map((l) => {
    const p = one<any>(l.properties);
    return {
      id: l.id as string,
      property: (p?.name ?? "—") as string,
      compound: (one<any>(p?.compounds)?.name ?? "") as string,
      start_date: l.start_date as string,
      end_date: l.end_date as string,
      active: Boolean(l.active),
      rent: Number(l.gross_rent_monthly || 0),
      deposit_charged: Number(l.deposit_charged ?? l.deposit_amount ?? 0),
      deposit_collected: Number(l.deposit_collected ?? 0),
      lessee: l.lessee_name as string,
      contact: (l.lessee_contact ?? null) as string | null,
    };
  });
  const leaseIds = leases.map((l) => l.id);
  const propByLease = new Map(leases.map((l) => [l.id, l.property]));

  const today = new Date().toISOString().slice(0, 10);
  const from = range.from || leases.reduce((m, l) => (l.start_date < m ? l.start_date : m), leases[0]!.start_date);
  const to = range.to || today;

  // 2. Charges (up to `to`; future rent isn't owed yet) and payments
  const [rentRes, costRes, payRes] = await Promise.all([
    sb.from("rent_collections").select("id, lease_id, due_date, due_month, net_amount").in("lease_id", leaseIds).lte("due_date", to).order("due_date"),
    sb.from("costs").select("id, lease_id, description, amount, due_date, incurred_on").eq("payable_by_lessee", true).in("lease_id", leaseIds),
    sb.from("payments").select("id, kind, lease_id, amount, paid_on, method, reference, notes, rent_collection_id, cost_id, rent_collections(due_month), costs(description)").in("lease_id", leaseIds).lte("paid_on", to).order("paid_on"),
  ]);
  for (const r of [rentRes, costRes, payRes]) if (r.error) throw new Error(r.error.message);

  type Raw = Omit<StatementLine, "balance"> & { sort: string };
  const raw: Raw[] = [];
  for (const r of (rentRes.data ?? []) as any[]) {
    raw.push({
      date: r.due_date, sort: `${r.due_date}-0`, kind: "rent",
      description: `Rent · ${monthName(String(r.due_month))}`,
      property: propByLease.get(r.lease_id) ?? "—", reference: null,
      charge: Number(r.net_amount || 0), payment: 0,
    });
  }
  for (const c of (costRes.data ?? []) as any[]) {
    const d = (c.due_date ?? c.incurred_on) as string;
    if (d > to) continue;
    raw.push({
      date: d, sort: `${d}-1`, kind: "cost",
      description: c.description, property: propByLease.get(c.lease_id) ?? "—", reference: null,
      charge: Number(c.amount || 0), payment: 0,
    });
  }
  for (const p of (payRes.data ?? []) as any[]) {
    if (p.kind === "deposit") continue; // deposits are held, not set against rent
    const what = p.kind === "rent"
      ? `rent ${one<any>(p.rent_collections)?.due_month ? monthName(String(one<any>(p.rent_collections).due_month)) : ""}`.trim()
      : one<any>(p.costs)?.description ?? "charge";
    const how = methodLabel(p.method);
    raw.push({
      date: p.paid_on, sort: `${p.paid_on}-2`, kind: "payment",
      description: Number(p.amount) < 0 ? `Correction · ${what}` : `Payment · ${what}${how !== "—" ? ` (${how})` : ""}`,
      property: propByLease.get(p.lease_id) ?? "—", reference: p.reference ?? null,
      charge: 0, payment: Number(p.amount || 0),
    });
  }
  raw.sort((a, b) => a.sort.localeCompare(b.sort));

  // 3. Opening balance, then the period with a running balance
  let opening = 0;
  const inPeriod: Raw[] = [];
  for (const r of raw) {
    if (r.date < from) opening += r.charge - r.payment;
    else inPeriod.push(r);
  }
  let bal = opening;
  const lines: StatementLine[] = inPeriod.map(({ sort: _s, ...r }) => {
    bal += r.charge - r.payment;
    return { ...r, balance: round(bal) };
  });
  const charges = inPeriod.reduce((s, r) => s + r.charge, 0);
  const payments = inPeriod.reduce((s, r) => s + r.payment, 0);

  const dCharged = leases.reduce((s, l) => s + l.deposit_charged, 0);
  const dReceived = leases.reduce((s, l) => s + l.deposit_collected, 0);

  return {
    lessee: leases[0]!.lessee,
    contact: leases.find((l) => l.contact)?.contact ?? null,
    leases: leases.map(({ id, property, compound, start_date, end_date, active, rent }) => ({ id, property, compound, start_date, end_date, active, rent })),
    from, to,
    opening: round(opening),
    charges: round(charges),
    payments: round(payments),
    closing: round(opening + charges - payments),
    lines,
    deposit: { charged: dCharged, received: dReceived, shortfall: Math.max(0, dCharged - dReceived) },
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
