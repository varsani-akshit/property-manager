import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who owes what, right now: overdue rent (due date passed, not fully paid),
 * unpaid lessee-billed costs that are due, and deposit shortfalls on active
 * leases — grouped by lessee. Used by the Reminders page and the MCP tools.
 */
export type OwedBy = {
  lessee: string;
  contact: string | null;
  leaseIds: string[];
  properties: string[];
  rent: number;
  rentRows: number;
  costs: number;
  costRows: number;
  deposit: number;
  total: number;
  oldestDue: string | null;  // earliest unpaid due date
  daysOverdue: number;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function outstandingByLessee(sb: SupabaseClient, today = new Date().toISOString().slice(0, 10)): Promise<OwedBy[]> {
  const [rentRes, costRes, leaseRes] = await Promise.all([
    sb.from("rent_collections")
      .select("lease_id, due_date, net_amount, collected_amount, properties(name), leases(lessee_name, lessee_contact)")
      .in("status", ["due", "partial", "overdue"]).lte("due_date", today),
    sb.from("costs")
      .select("lease_id, due_date, amount, collected_amount, leases(lessee_name, lessee_contact, properties(name))")
      .eq("payable_by_lessee", true).in("collection_status", ["due", "partial"]).lte("due_date", today),
    sb.from("leases")
      .select("id, lessee_name, lessee_contact, deposit_charged, deposit_collected, properties(name)")
      .eq("active", true),
  ]);
  for (const r of [rentRes, costRes, leaseRes]) if (r.error) throw new Error(r.error.message);

  const map = new Map<string, OwedBy>();
  const get = (name: string, contact: string | null) => {
    let g = map.get(name);
    if (!g) {
      g = { lessee: name, contact, leaseIds: [], properties: [], rent: 0, rentRows: 0, costs: 0, costRows: 0, deposit: 0, total: 0, oldestDue: null, daysOverdue: 0 };
      map.set(name, g);
    }
    if (!g.contact && contact) g.contact = contact;
    return g;
  };
  const addProp = (g: OwedBy, p?: string | null) => { if (p && !g.properties.includes(p)) g.properties.push(p); };
  const addLease = (g: OwedBy, id?: string | null) => { if (id && !g.leaseIds.includes(id)) g.leaseIds.push(id); };
  const older = (g: OwedBy, d: string) => { if (!g.oldestDue || d < g.oldestDue) g.oldestDue = d; };

  for (const r of (rentRes.data ?? []) as any[]) {
    const rem = Math.max(0, Number(r.net_amount || 0) - Number(r.collected_amount || 0));
    if (rem <= 0) continue;
    const l = one<any>(r.leases);
    const g = get(l?.lessee_name ?? "(unknown)", l?.lessee_contact ?? null);
    g.rent += rem; g.rentRows += 1;
    addProp(g, one<any>(r.properties)?.name); addLease(g, r.lease_id); older(g, r.due_date);
  }
  for (const c of (costRes.data ?? []) as any[]) {
    const rem = Math.max(0, Number(c.amount || 0) - Number(c.collected_amount || 0));
    if (rem <= 0) continue;
    const l = one<any>(c.leases);
    const g = get(l?.lessee_name ?? "(unknown)", l?.lessee_contact ?? null);
    g.costs += rem; g.costRows += 1;
    addProp(g, one<any>(l?.properties)?.name); addLease(g, c.lease_id); if (c.due_date) older(g, c.due_date);
  }
  for (const l of (leaseRes.data ?? []) as any[]) {
    const short = Math.max(0, Number(l.deposit_charged || 0) - Number(l.deposit_collected || 0));
    if (short <= 0) continue;
    const g = get(l.lessee_name, l.lessee_contact ?? null);
    g.deposit += short;
    addProp(g, one<any>(l.properties)?.name); addLease(g, l.id);
  }

  const t = new Date(today + "T00:00:00Z").getTime();
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      total: Math.round((g.rent + g.costs + g.deposit) * 100) / 100,
      daysOverdue: g.oldestDue ? Math.max(0, Math.round((t - new Date(g.oldestDue + "T00:00:00Z").getTime()) / 86400000)) : 0,
    }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
}
