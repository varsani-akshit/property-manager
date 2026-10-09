// Pure analytics over the fact set (lib/analytics/types.ts). Runs in the
// browser, so every filter / drill-down re-computes instantly.
//
// Definitions (shown in the UI's info tips too):
//   billed           rent falling due in the period
//   collection rate  share of that billed rent that has been paid (whenever paid)
//   received         rent money received in the period (payment log, by date paid)
//   outstanding      unpaid rent already due, as of today (not period-bound)
//   net              received − landlord costs in the period
//   yield            net ÷ valuation, annualised
//   occupancy        units with a lease running on the period's last day (or today)

import type { Facts } from "./types";

export type Dim = "compound" | "property" | "lessee";

export type Filters = {
  preset: string;          // "30d" | "3m" | "6m" | "12m" | "ytd" | "all" | "custom"
  from: string;
  to: string;
  compounds: number[];
  properties: number[];
  lessees: string[];
  staff: number[];
  compare: boolean;
};

export const PRESETS: { key: string; label: string }[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "12m", label: "Last 12 months" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const addMonths = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const ym = (s: string) => s.slice(0, 7);

export function presetRange(key: string, today: string, facts?: Facts): { from: string; to: string } {
  switch (key) {
    case "30d": return { from: addDays(today, -29), to: today };
    case "3m": return { from: addDays(addMonths(today, -3), 1), to: today };
    case "6m": return { from: addDays(addMonths(today, -6), 1), to: today };
    case "ytd": return { from: today.slice(0, 4) + "-01-01", to: today };
    case "all": return { from: facts?.rent[0]?.[1] ?? "2000-01-01", to: today };
    case "12m":
    default: return { from: addDays(addMonths(today, -12), 1), to: today };
  }
}

export function previousRange(from: string, to: string) {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

// ─── Scope ──────────────────────────────────────────────────────────────────

export type Scope = {
  props: Set<number>;   // properties in scope (incl. archived, for money)
  leases: Set<number>;  // leases in scope
  units: number[];      // non-archived properties counted for occupancy / valuation
};

export function scopeOf(f: Facts, flt: Pick<Filters, "compounds" | "properties" | "lessees">): Scope {
  const props = new Set<number>();
  f.properties.forEach((p, i) => {
    if (flt.properties.length ? flt.properties.includes(i) : flt.compounds.length ? flt.compounds.includes(p.c) : true) props.add(i);
  });
  const lesseeSet = flt.lessees.length ? new Set(flt.lessees) : null;
  const leases = new Set<number>();
  f.leases.forEach((l, i) => { if (props.has(l.p) && (!lesseeSet || lesseeSet.has(l.lessee))) leases.add(i); });
  let units = [...props].filter((i) => !f.properties[i]!.archived);
  if (lesseeSet) {
    const theirs = new Set([...leases].map((i) => f.leases[i]!.p));
    units = units.filter((i) => theirs.has(i));
  }
  return { props, leases, units };
}

const leaseRunning = (l: Facts["leases"][number], d: string) =>
  l.start <= d && l.end >= d && (!l.cancelled || l.cancelled > d);

// ─── Metrics ────────────────────────────────────────────────────────────────

export type Metrics = {
  billed: number;
  billedPaid: number;
  collectionRate: number | null;
  received: number;
  chargesBilled: number;
  chargesReceived: number;
  depositsReceived: number;
  costs: number;
  net: number;
  outstanding: number;
  overdueItems: number;
  overdueLessees: number;
  oldestDays: number;
  chargesOutstanding: number;
  depositShortfall: number;
  depositsHeld: number;
  units: number;
  leased: number;
  occupancy: number | null;
  sqft: number;
  leasedSqft: number;
  valuation: number;
  monthlyRent: number;
  rentPerSqft: number | null;
  yieldPct: number | null;
  vacantPotential: number;           // vacant sqft × average rent per sqft
  expiring90: number;
  expiring90Rent: number;
  punctualPayments: number;          // logged rent payments with a due date, paid in period
  onTimePct: number | null;          // paid within 5 days of due date
  avgDaysLate: number | null;
};

export function metrics(f: Facts, s: Scope, from: string, to: string, staff: number[] = []): Metrics {
  const today = f.today;
  const ref = to < today ? to : today;
  const staffSet = staff.length ? new Set(staff) : null;
  const leaseLessees = new Set<string>();

  let billed = 0, billedPaid = 0, outstanding = 0, overdueItems = 0, oldest = "";
  for (const [li, due, net, col] of f.rent) {
    if (!s.leases.has(li)) continue;
    if (due >= from && due <= to) { billed += net; billedPaid += Math.min(col, net); }
    if (due <= today && net - col > 0.005) {
      outstanding += net - col; overdueItems++;
      leaseLessees.add(f.leases[li]!.lessee);
      if (!oldest || due < oldest) oldest = due;
    }
  }

  let received = 0, chargesReceived = 0, depositsReceived = 0;
  let punctual = 0, onTime = 0, lateSum = 0;
  for (const [k, li, paid, amt, method, person, due] of f.payments) {
    if (li < 0 || !s.leases.has(li) || paid < from || paid > to) continue;
    if (staffSet && !staffSet.has(person)) continue;
    if (k === "r") {
      received += amt;
      if (method !== "opening" && due && amt > 0) {
        const late = daysBetween(due, paid);
        punctual++; if (late <= 5) onTime++; lateSum += Math.max(0, late);
      }
    } else if (k === "c") chargesReceived += amt;
    else depositsReceived += amt;
  }

  let chargesBilled = 0, chargesOutstanding = 0;
  for (const [li, due, , amt, col] of f.charges) {
    if (!s.leases.has(li)) continue;
    if (due >= from && due <= to) chargesBilled += amt;
    if (due <= today) chargesOutstanding += Math.max(0, amt - col);
  }

  let costs = 0;
  for (const [pi, d, , amt] of f.costs) if (s.props.has(pi) && d >= from && d <= to) costs += amt;

  let depositShortfall = 0, depositsHeld = 0, monthlyRent = 0, expiring90 = 0, expiring90Rent = 0;
  const leasedUnits = new Set<number>();
  const in90 = addDays(today, 90);
  for (const li of s.leases) {
    const l = f.leases[li]!;
    if (l.active) { depositShortfall += Math.max(0, l.depCharged - l.depHeld); depositsHeld += l.depHeld; }
    if (leaseRunning(l, ref)) { leasedUnits.add(l.p); monthlyRent += l.rent; }
    if (l.active && l.end >= today && l.end <= in90) { expiring90++; expiring90Rent += l.rent; }
  }

  let sqft = 0, leasedSqft = 0, valuation = 0;
  for (const pi of s.units) {
    const p = f.properties[pi]!;
    sqft += p.sqft; valuation += p.value;
    if (leasedUnits.has(pi)) leasedSqft += p.sqft;
  }
  const leased = s.units.filter((u) => leasedUnits.has(u)).length;
  const days = Math.max(1, daysBetween(from, to) + 1);
  const net = received - costs;
  const rentPerSqft = leasedSqft > 0 ? monthlyRent / leasedSqft : null;

  return {
    billed, billedPaid,
    collectionRate: billed > 0 ? billedPaid / billed : null,
    received, chargesBilled, chargesReceived, depositsReceived, costs, net,
    outstanding, overdueItems, overdueLessees: leaseLessees.size,
    oldestDays: oldest ? daysBetween(oldest, today) : 0,
    chargesOutstanding, depositShortfall, depositsHeld,
    units: s.units.length, leased,
    occupancy: s.units.length ? leased / s.units.length : null,
    sqft, leasedSqft, valuation, monthlyRent, rentPerSqft,
    yieldPct: valuation > 0 ? (net / valuation) * (365 / days) : null,
    vacantPotential: rentPerSqft ? (sqft - leasedSqft) * rentPerSqft : 0,
    expiring90, expiring90Rent,
    punctualPayments: punctual,
    onTimePct: punctual ? onTime / punctual : null,
    avgDaysLate: punctual ? lateSum / punctual : null,
  };
}

// ─── Monthly series ─────────────────────────────────────────────────────────

export type MonthPoint = { month: string; billed: number; paidAgainst: number; received: number; costs: number; rate: number | null };

export function monthly(f: Facts, s: Scope, from: string, to: string, staff: number[] = []): MonthPoint[] {
  const months: string[] = [];
  for (let m = ym(from); m <= ym(to); m = ym(addMonths(m + "-01", 1))) months.push(m);
  if (months.length > 60) months.splice(0, months.length - 60);
  const by = new Map(months.map((m) => [m, { month: m, billed: 0, paidAgainst: 0, received: 0, costs: 0, rate: null as number | null }]));
  const staffSet = staff.length ? new Set(staff) : null;
  for (const [li, due, net, col] of f.rent) {
    if (!s.leases.has(li) || due < from || due > to) continue;
    const b = by.get(ym(due)); if (!b) continue;
    b.billed += net; b.paidAgainst += Math.min(col, net);
  }
  for (const [k, li, paid, amt, , person] of f.payments) {
    if (k !== "r" || li < 0 || !s.leases.has(li) || paid < from || paid > to) continue;
    if (staffSet && !staffSet.has(person)) continue;
    const b = by.get(ym(paid)); if (b) b.received += amt;
  }
  for (const [pi, d, , amt] of f.costs) {
    if (!s.props.has(pi) || d < from || d > to) continue;
    const b = by.get(ym(d)); if (b) b.costs += amt;
  }
  return [...by.values()].map((b) => ({ ...b, rate: b.billed > 0 ? b.paidAgainst / b.billed : null }));
}

// ─── Breakdown by compound / property / lessee ──────────────────────────────

export type DimRow = {
  key: string;            // compound/property index as string, or lessee name
  label: string;
  sub?: string;
  href?: string;
  m: Metrics;
};

export function breakdown(f: Facts, flt: Filters, dim: Dim): DimRow[] {
  const base = scopeOf(f, flt);
  const rows: DimRow[] = [];
  if (dim === "compound") {
    const cs = new Set([...base.props].map((p) => f.properties[p]!.c));
    for (const ci of cs) {
      const s = scopeOf(f, { ...flt, compounds: [ci], properties: flt.properties.filter((p) => f.properties[p]!.c === ci) });
      rows.push({ key: String(ci), label: f.compounds[ci]?.name ?? "—", sub: `${s.units.length} units`, href: `/compounds/${f.compounds[ci]?.id}`, m: metrics(f, s, flt.from, flt.to, flt.staff) });
    }
  } else if (dim === "property") {
    for (const pi of base.props) {
      const p = f.properties[pi]!;
      if (p.archived && !f.rent.some(([li]) => f.leases[li]?.p === pi)) continue;
      const s = scopeOf(f, { ...flt, properties: [pi] });
      const current = f.leases.find((l) => l.p === pi && l.active);
      rows.push({ key: String(pi), label: p.name, sub: f.compounds[p.c]?.name + (current ? ` · ${current.lessee}` : " · vacant"), href: `/properties/${p.id}`, m: metrics(f, s, flt.from, flt.to, flt.staff) });
    }
  } else {
    const names = new Set([...base.leases].map((l) => f.leases[l]!.lessee));
    for (const name of names) {
      const s = scopeOf(f, { ...flt, lessees: [name] });
      const units = [...s.leases].map((l) => f.properties[f.leases[l]!.p]?.name).filter(Boolean);
      rows.push({ key: name, label: name, sub: [...new Set(units)].slice(0, 3).join(", "), href: `/rent/statement?lessee=${encodeURIComponent(name)}`, m: metrics(f, s, flt.from, flt.to, flt.staff) });
    }
  }
  return rows;
}

// ─── Aging, expiry, forecast, mixes ─────────────────────────────────────────

export const AGING = [
  { key: "0-30", label: "1–30 days", min: 1, max: 30 },
  { key: "31-60", label: "31–60", min: 31, max: 60 },
  { key: "61-90", label: "61–90", min: 61, max: 90 },
  { key: "91-180", label: "91–180", min: 91, max: 180 },
  { key: "180+", label: "180+ days", min: 181, max: Infinity },
] as const;

export type OverdueItem = { lessee: string; property: string; propertyId: string; due: string; days: number; amount: number };

export function overdueItems(f: Facts, s: Scope): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const [li, due, net, col] of f.rent) {
    if (!s.leases.has(li) || due > f.today || net - col <= 0.005) continue;
    const l = f.leases[li]!; const p = f.properties[l.p]!;
    out.push({ lessee: l.lessee, property: p.name, propertyId: p.id, due, days: Math.max(0, daysBetween(due, f.today)), amount: net - col });
  }
  return out.sort((a, b) => b.days - a.days);
}

export function aging(items: OverdueItem[]) {
  return AGING.map((b) => {
    const these = items.filter((i) => i.days >= b.min && i.days <= b.max);
    return { ...b, amount: these.reduce((t, i) => t + i.amount, 0), count: these.length };
  });
}

export function expiryTimeline(f: Facts, s: Scope, months = 12) {
  const start = ym(f.today);
  const out: { month: string; count: number; rent: number; leases: { lessee: string; property: string; end: string; rent: number; id: string }[] }[] = [];
  for (let i = 0; i < months; i++) out.push({ month: ym(addMonths(start + "-01", i)), count: 0, rent: 0, leases: [] });
  const by = new Map(out.map((o) => [o.month, o]));
  for (const li of s.leases) {
    const l = f.leases[li]!;
    if (!l.active || l.end < f.today) continue;
    const b = by.get(ym(l.end)); if (!b) continue;
    b.count++; b.rent += l.rent; b.leases.push({ lessee: l.lessee, property: f.properties[l.p]?.name ?? "—", end: l.end, rent: l.rent, id: l.id });
  }
  return out;
}

export function forecast(f: Facts, s: Scope, months = 6) {
  const out: { month: string; due: number; unpaid: number }[] = [];
  for (let i = 0; i < months; i++) out.push({ month: ym(addMonths(f.today.slice(0, 7) + "-01", i)), due: 0, unpaid: 0 });
  const by = new Map(out.map((o) => [o.month, o]));
  for (const [li, due, net, col] of f.rent) {
    if (!s.leases.has(li) || due <= f.today) continue;
    const b = by.get(ym(due)); if (!b) continue;
    b.due += net; b.unpaid += Math.max(0, net - col);
  }
  return out;
}

export function paymentMix(f: Facts, s: Scope, from: string, to: string, staff: number[] = []) {
  const byMethod = new Map<string, number>(), byPerson = new Map<number, number>();
  const staffSet = staff.length ? new Set(staff) : null;
  for (const [k, li, paid, amt, method, person] of f.payments) {
    if (k === "d" || li < 0 || !s.leases.has(li) || paid < from || paid > to) continue;
    if (staffSet && !staffSet.has(person)) continue;
    byMethod.set(method, (byMethod.get(method) ?? 0) + amt);
    byPerson.set(person, (byPerson.get(person) ?? 0) + amt);
  }
  return { byMethod, byPerson };
}

export function costsByCategory(f: Facts, s: Scope, from: string, to: string) {
  const by = new Map<string, number>();
  for (const [pi, d, cat, amt] of f.costs) if (s.props.has(pi) && d >= from && d <= to) by.set(cat, (by.get(cat) ?? 0) + amt);
  return [...by].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function chargesByCategory(f: Facts, s: Scope, from: string, to: string) {
  const by = new Map<string, { billed: number; collected: number }>();
  for (const [li, d, cat, amt, col] of f.charges) {
    if (!s.leases.has(li) || d < from || d > to) continue;
    const b = by.get(cat) ?? { billed: 0, collected: 0 }; b.billed += amt; b.collected += col; by.set(cat, b);
  }
  return [...by].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.billed - a.billed);
}

export function serviceChargeLiability(f: Facts, s: Scope) {
  let pending = 0, pendingCount = 0, paid = 0;
  for (const [pi, , amt, status] of f.sc) {
    if (!s.props.has(pi)) continue;
    if (status === "pending") { pending += amt; pendingCount++; } else if (status === "paid") paid += amt;
  }
  return { pending, pendingCount, paid };
}

// ─── Insights ───────────────────────────────────────────────────────────────

export type Insight = { tone: "good" | "warn" | "bad" | "info"; text: string; action?: { label: string; patch: Partial<Filters> & { dim?: Dim } } };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ksh = (v: number) => `Ksh ${Math.round(v).toLocaleString("en-KE")}`;

export function insights(f: Facts, flt: Filters, cur: Metrics, prev: Metrics | null, byLessee: DimRow[], byProperty: DimRow[], items: OverdueItem[]): Insight[] {
  const out: Insight[] = [];
  if (prev && cur.collectionRate != null && prev.collectionRate != null) {
    const d = cur.collectionRate - prev.collectionRate;
    if (Math.abs(d) >= 0.05) out.push({ tone: d > 0 ? "good" : "bad", text: `Collection rate ${d > 0 ? "up" : "down"} ${Math.round(Math.abs(d) * 100)} pts to ${pct(cur.collectionRate)} vs the previous period.` });
  }
  if (prev && prev.received > 0) {
    const d = (cur.received - prev.received) / prev.received;
    if (Math.abs(d) >= 0.1) out.push({ tone: d > 0 ? "good" : "warn", text: `Rent received is ${d > 0 ? "up" : "down"} ${Math.round(Math.abs(d) * 100)}% (${ksh(cur.received)} vs ${ksh(prev.received)}).` });
  }
  const owing = byLessee.filter((r) => r.m.outstanding > 0).sort((a, b) => b.m.outstanding - a.m.outstanding);
  if (owing.length && cur.outstanding > 0) {
    const top3 = owing.slice(0, 3).reduce((t, r) => t + r.m.outstanding, 0);
    out.push({
      tone: "warn",
      text: `${owing[0]!.label} owes the most (${ksh(owing[0]!.m.outstanding)}); the top 3 lessees hold ${pct(top3 / cur.outstanding)} of all overdue rent.`,
      action: { label: `Focus ${owing[0]!.label}`, patch: { lessees: [owing[0]!.label] } },
    });
  }
  const old = items.filter((i) => i.days > 90);
  if (old.length) {
    const amt = old.reduce((t, i) => t + i.amount, 0);
    const n = new Set(old.map((i) => i.lessee)).size;
    out.push({ tone: "bad", text: `${ksh(amt)} has been overdue for more than 90 days across ${n} lessee${n === 1 ? "" : "s"} — consider escalating.` });
  }
  if (cur.expiring90 > 0) out.push({ tone: "info", text: `${cur.expiring90} lease${cur.expiring90 === 1 ? "" : "s"} worth ${ksh(cur.expiring90Rent)}/month end within 90 days — start renewal talks.` });
  if (cur.units - cur.leased > 0 && cur.vacantPotential > 0) {
    out.push({ tone: "info", text: `${cur.units - cur.leased} vacant unit${cur.units - cur.leased === 1 ? "" : "s"} (${Math.round(cur.sqft - cur.leasedSqft).toLocaleString()} sqft) — about ${ksh(cur.vacantPotential)}/month at today's average rent per sqft.` });
  }
  if (cur.depositShortfall > 0) out.push({ tone: "warn", text: `Deposits are short by ${ksh(cur.depositShortfall)} on active leases.` });
  const withYield = byProperty.filter((r) => r.m.yieldPct != null && r.m.valuation > 0 && r.m.billed > 0);
  if (withYield.length >= 3) {
    const sorted = [...withYield].sort((a, b) => (a.m.yieldPct ?? 0) - (b.m.yieldPct ?? 0));
    const lo = sorted[0]!, hi = sorted[sorted.length - 1]!;
    out.push({ tone: "info", text: `Best yield: ${hi.label} (${((hi.m.yieldPct ?? 0) * 100).toFixed(1)}%). Weakest: ${lo.label} (${((lo.m.yieldPct ?? 0) * 100).toFixed(1)}%).`, action: { label: `Look at ${lo.label}`, patch: { properties: [Number(lo.key)] } } });
  }
  if (cur.onTimePct != null && cur.punctualPayments >= 5) out.push({ tone: cur.onTimePct >= 0.8 ? "good" : "warn", text: `${pct(cur.onTimePct)} of logged rent payments arrived within 5 days of the due date (avg ${Math.round(cur.avgDaysLate ?? 0)} days late).` });
  if (!out.length) out.push({ tone: "good", text: "Nothing stands out for this selection." });
  return out;
}
