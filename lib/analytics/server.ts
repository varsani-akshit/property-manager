import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "../supabase/admin";
import { supabaseServer } from "../supabase/server";
import { DATA_TAG } from "../revalidate";
import type { Facts } from "./types";

type Raw = {
  generatedAt: string;
  compounds: [string, string][];
  properties: [string, string, string, number, number, number, boolean][];
  leases: [string, string, string, string, string, number, boolean, number, number, string | null][];
  rent: [string, string, number, number][];
  payments: [string, string | null, string, number, string, string | null, string | null][];
  costs: [string, string, string, number][];
  charges: [string, string, string, number, number][];
  serviceCharges: [string, string, number, string][];
  people: [string, string][];
};

/** Swap uuids for array indexes so the browser gets a small, flat payload. */
function compact(raw: Raw): Facts {
  const ix = <T extends unknown[]>(rows: T[]) => new Map(rows.map((r, i) => [r[0] as string, i]));
  const cIx = ix(raw.compounds), pIx = ix(raw.properties), lIx = ix(raw.leases), uIx = ix(raw.people);
  const n = (v: unknown) => Number(v) || 0;
  return {
    generatedAt: raw.generatedAt,
    today: new Date().toISOString().slice(0, 10),
    compounds: raw.compounds.map(([id, name]) => ({ id, name })),
    properties: raw.properties.map(([id, name, c, sqft, value, sc, archived]) => ({ id, name, c: cIx.get(c) ?? -1, sqft: n(sqft), value: n(value), sc: n(sc), archived })),
    leases: raw.leases.map(([id, p, lessee, start, end, rent, active, dc, dh, cancelled]) => ({
      id, p: pIx.get(p) ?? -1, lessee, start, end, rent: n(rent), active, depCharged: n(dc), depHeld: n(dh), cancelled,
    })),
    lessees: [...new Set(raw.leases.map((l) => l[2]))].sort((a, b) => a.localeCompare(b)),
    people: raw.people.map(([id, name]) => ({ id, name })),
    rent: raw.rent.map(([l, d, net, col]) => [lIx.get(l) ?? -1, d, n(net), n(col)]),
    payments: raw.payments.map(([k, l, d, a, m, u, due]) => [k, l ? lIx.get(l) ?? -1 : -1, d, n(a), m, u ? uIx.get(u) ?? -1 : -1, due]),
    costs: raw.costs.map(([p, d, cat, a]) => [pIx.get(p) ?? -1, d, cat, n(a)]),
    charges: raw.charges.map(([l, d, cat, a, col]) => [lIx.get(l) ?? -1, d, cat, n(a), n(col)]),
    sc: raw.serviceCharges.map(([p, m, a, s]) => [pIx.get(p) ?? -1, m, n(a), s]),
  };
}

const cached = unstable_cache(
  async () => {
    const { data, error } = await supabaseAdmin().rpc("analytics_facts");
    if (error) throw new Error(error.message);
    return compact(data as Raw);
  },
  ["analytics-facts-v1"],
  { revalidate: 120, tags: [DATA_TAG] }
);

/**
 * Every fact the dashboards need, cached across requests and dropped on any
 * write (revalidateApp). Callers must have checked view_dashboard. Falls back to
 * an uncached read with the user's session if the service key is missing.
 */
export async function getAnalyticsFacts(): Promise<Facts> {
  try {
    return await cached();
  } catch (e) {
    console.error("analytics cache unavailable, reading directly:", (e as Error).message);
    const { data, error } = await (await supabaseServer()).rpc("analytics_facts");
    if (error) throw new Error(error.message);
    return compact(data as Raw);
  }
}

/**
 * Facts limited to one scope (a compound, property or lease) for the detail
 * pages, which people can open without Dashboard access: rows outside the
 * scope are dropped and out-of-scope records blanked (indexes are kept, since
 * rows refer to records by position).
 */
export function pruneFacts(f: Facts, keep: { compoundId?: string; propertyId?: string; leaseIds?: string[] }): Facts {
  const props = new Set<number>();
  f.properties.forEach((p, i) => {
    if (keep.propertyId ? p.id === keep.propertyId : keep.compoundId ? f.compounds[p.c]?.id === keep.compoundId : false) props.add(i);
  });
  const leaseIdSet = keep.leaseIds ? new Set(keep.leaseIds) : null;
  const leases = new Set<number>();
  f.leases.forEach((l, i) => { if (leaseIdSet ? leaseIdSet.has(l.id) : props.has(l.p)) { leases.add(i); props.add(l.p); } });
  const comps = new Set([...props].map((p) => f.properties[p]!.c));
  return {
    ...f,
    compounds: f.compounds.map((c, i) => (comps.has(i) ? c : { id: "", name: "" })),
    properties: f.properties.map((p, i) => (props.has(i) ? p : { id: "", name: "", c: -1, sqft: 0, value: 0, sc: 0, archived: true })),
    leases: f.leases.map((l, i) => (leases.has(i) ? l : { id: "", p: -1, lessee: "", start: "", end: "", rent: 0, active: false, depCharged: 0, depHeld: 0, cancelled: null })),
    lessees: [...new Set([...leases].map((i) => f.leases[i]!.lessee))].sort(),
    rent: f.rent.filter(([l]) => leases.has(l)),
    payments: f.payments.filter(([, l]) => leases.has(l)),
    costs: f.costs.filter(([p]) => props.has(p)),
    charges: f.charges.filter(([l]) => leases.has(l)),
    sc: f.sc.filter(([p]) => props.has(p)),
  };
}
