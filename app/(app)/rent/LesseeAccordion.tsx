"use client";
import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown } from "lucide-react";
import { money, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

type PropRef = {
  name: string;
  compounds: { name: string } | { name: string }[] | null;
};

export type RawRentRow = {
  id: string;
  due_date: string;
  gross_amount: number;
  net_amount: number;
  collected_amount: number;
  status: string;
  collected_at: string | null;
  lease_id: string;
  property_id: string;
  properties: PropRef | PropRef[] | null;
  leases: { id: string; lessee_name: string; lessee_contact: string | null } | { id: string; lessee_name: string; lessee_contact: string | null }[] | null;
};

type CostLeaseRef = {
  id: string;
  lessee_name: string;
  lessee_contact: string | null;
  property_id: string;
  properties: PropRef | PropRef[] | null;
};

export type RawCostRow = {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  collected_amount: number;
  collection_status: string;
  collected_at: string | null;
  lease_id: string | null;
  leases: CostLeaseRef | CostLeaseRef[] | null;
  cost_line_items: { category: string; amount: number }[] | null;
};

function compoundOf(prop: PropRef | null): string {
  if (!prop) return "";
  const c = prop.compounds;
  if (!c) return "";
  return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
}

function pickOne<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

type Bucket = "outstanding" | "upcoming" | "cost_due" | "collected";

type CollectedItem =
  | { kind: "rent"; row: RawRentRow }
  | { kind: "cost"; row: RawCostRow };

type LesseeGroup = {
  lessee_name: string;
  contact: string | null;
  properties: string[];
  compound: string; // compound of the first property — used for grouping/sort
  outstanding_total: number;
  outstanding_count: number;
  upcoming_total: number;
  upcoming_count: number;
  cost_due_total: number;
  cost_due_count: number;
  deposit_shortfall: number;
  collected_total: number;
  collected_count: number;
  rentRows: RawRentRow[];
  costRows: RawCostRow[];
};

function rentBucketOf(r: RawRentRow, today: string, upcomingHorizon: string): Bucket | null {
  if (r.status === "collected") return "collected";
  if (r.status === "due" || r.status === "partial") {
    if (r.due_date <= today) return "outstanding";
    if (r.due_date <= upcomingHorizon) return "upcoming";
  }
  return null;
}

function costBucketOf(c: RawCostRow): Bucket | null {
  if (c.collection_status === "collected") return "collected";
  if (c.collection_status === "due" || c.collection_status === "partial") return "cost_due";
  return null;
}

function rentRemainder(r: RawRentRow): number {
  return Math.max(0, Number(r.net_amount) - Number(r.collected_amount));
}
function costRemainder(c: RawCostRow): number {
  return Math.max(0, Number(c.amount) - Number(c.collected_amount));
}

export function LesseeAccordion({
  rentRows,
  costRows,
  depositShortfallByLessee,
  today,
  upcomingHorizon,
  canMarkRent,
  markFullAction,
  markCostFullAction,
}: {
  rentRows: RawRentRow[];
  costRows: RawCostRow[];
  depositShortfallByLessee: Record<string, number>;
  today: string;
  upcomingHorizon: string;
  canMarkRent: boolean;
  markFullAction: (fd: FormData) => Promise<void>;
  markCostFullAction: (fd: FormData) => Promise<void>;
}) {
  const groups: LesseeGroup[] = useMemo(() => {
    const map = new Map<string, LesseeGroup>();

    function ensureGroup(name: string, contact: string | null): LesseeGroup {
      if (!map.has(name)) {
        map.set(name, {
          lessee_name: name,
          contact,
          properties: [],
          compound: "",
          outstanding_total: 0,
          outstanding_count: 0,
          upcoming_total: 0,
          upcoming_count: 0,
          cost_due_total: 0,
          cost_due_count: 0,
          deposit_shortfall: depositShortfallByLessee[name] ?? 0,
          collected_total: 0,
          collected_count: 0,
          rentRows: [],
          costRows: [],
        });
      }
      return map.get(name)!;
    }

    for (const r of rentRows) {
      const lease = pickOne(r.leases);
      if (!lease) continue;
      const bucket = rentBucketOf(r, today, upcomingHorizon);
      if (!bucket) continue;
      const g = ensureGroup(lease.lessee_name || "(unknown)", lease.lessee_contact ?? null);
      const propRef = pickOne(r.properties);
      const prop = propRef?.name ?? "";
      if (prop && !g.properties.includes(prop)) g.properties.push(prop);
      if (!g.compound) g.compound = compoundOf(propRef);
      g.rentRows.push(r);
      if (bucket === "outstanding") { g.outstanding_total += rentRemainder(r); g.outstanding_count += 1; }
      else if (bucket === "upcoming") { g.upcoming_total += rentRemainder(r); g.upcoming_count += 1; }
      else if (bucket === "collected") { g.collected_total += Number(r.collected_amount || 0); g.collected_count += 1; }
    }

    for (const c of costRows) {
      const lease = pickOne(c.leases);
      if (!lease) continue;
      const bucket = costBucketOf(c);
      if (!bucket) continue;
      const g = ensureGroup(lease.lessee_name || "(unknown)", lease.lessee_contact ?? null);
      const propRef = pickOne(lease.properties);
      const prop = propRef?.name ?? "";
      if (prop && !g.properties.includes(prop)) g.properties.push(prop);
      if (!g.compound) g.compound = compoundOf(propRef);
      g.costRows.push(c);
      if (bucket === "cost_due") { g.cost_due_total += costRemainder(c); g.cost_due_count += 1; }
      else if (bucket === "collected") { g.collected_total += Number(c.collected_amount || 0); g.collected_count += 1; }
    }

    // Ensure lessees who have ONLY a deposit shortfall (no rent/cost) still appear.
    for (const [name, shortfall] of Object.entries(depositShortfallByLessee)) {
      if (shortfall > 0 && !map.has(name)) ensureGroup(name, null);
    }

    // Natural alphanumeric sort by (compound, first property name, lessee).
    const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return Array.from(map.values()).sort((a, b) => {
      const c1 = nat.compare(a.compound, b.compound);
      if (c1 !== 0) return c1;
      const c2 = nat.compare(a.properties[0] ?? "", b.properties[0] ?? "");
      if (c2 !== 0) return c2;
      return nat.compare(a.lessee_name, b.lessee_name);
    });
  }, [rentRows, costRows, depositShortfallByLessee, today, upcomingHorizon]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Record<string, Bucket>>({});

  function toggle(name: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else {
        next.add(name);
        if (!tabs[name]) {
          const g = groups.find((x) => x.lessee_name === name)!;
          const def: Bucket =
            g.outstanding_count > 0 ? "outstanding"
            : g.cost_due_count > 0 ? "cost_due"
            : g.upcoming_count > 0 ? "upcoming"
            : "collected";
          setTabs((t) => ({ ...t, [name]: def }));
        }
      }
      return next;
    });
  }

  return (
    <div className="card p-0">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>Lessee · Property</th>
              <th className="text-right">Total Outstanding</th>
              <th className="text-right">Upcoming (6 mo)</th>
              <th className="text-right">Collected (4 mo)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.lessee_name);
              const activeTab: Bucket = tabs[g.lessee_name] ?? "outstanding";
              const totalOutstanding = g.outstanding_total + g.cost_due_total + g.deposit_shortfall;
              return (
                <Fragment key={g.lessee_name}>
                  <tr
                    onClick={() => toggle(g.lessee_name)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <td className="text-muted-fg">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="max-w-md">
                      <div className="font-medium">{g.lessee_name}</div>
                      <div className="text-xs text-muted-fg truncate" title={g.properties.join(", ")}>
                        {g.properties.join(", ") || (g.contact ?? "")}
                      </div>
                    </td>
                    <td className={cn("text-right tabular-nums font-semibold", totalOutstanding > 0 && "text-danger")}>
                      {money(totalOutstanding)}
                      {totalOutstanding > 0 && (
                        <div className="text-[10px] text-muted-fg font-normal">
                          {g.outstanding_total > 0 && <>rent {money(g.outstanding_total)}</>}
                          {g.cost_due_total > 0 && <> · cost {money(g.cost_due_total)}</>}
                          {g.deposit_shortfall > 0 && <> · dep {money(g.deposit_shortfall)}</>}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {money(g.upcoming_total)}
                      {g.upcoming_count > 0 && <span className="text-xs text-muted-fg ml-1">({g.upcoming_count})</span>}
                    </td>
                    <td className="text-right tabular-nums text-success">
                      {money(g.collected_total)}
                      {g.collected_count > 0 && <span className="text-xs text-muted-fg ml-1">({g.collected_count})</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="p-3">
                        <Tabs
                          group={g}
                          today={today}
                          upcomingHorizon={upcomingHorizon}
                          active={activeTab}
                          setActive={(t) => setTabs((s) => ({ ...s, [g.lessee_name]: t }))}
                          canMarkRent={canMarkRent}
                          markFullAction={markFullAction}
                          markCostFullAction={markCostFullAction}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!groups.length && (
              <tr>
                <td colSpan={5} className="text-center text-muted-fg py-8">
                  No rent or cost activity in the current scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tabs({
  group,
  today,
  upcomingHorizon,
  active,
  setActive,
  canMarkRent,
  markFullAction,
  markCostFullAction,
}: {
  group: LesseeGroup;
  today: string;
  upcomingHorizon: string;
  active: Bucket;
  setActive: (t: Bucket) => void;
  canMarkRent: boolean;
  markFullAction: (fd: FormData) => Promise<void>;
  markCostFullAction: (fd: FormData) => Promise<void>;
}) {
  const labels: { key: Bucket; label: string; count: number }[] = [
    { key: "outstanding", label: "Due", count: group.outstanding_count },
    { key: "upcoming",   label: "Upcoming", count: group.upcoming_count },
    { key: "cost_due",   label: "Cost Due", count: group.cost_due_count },
    { key: "collected",  label: "Collected", count: group.collected_count },
  ];

  return (
    <div>
      <div className="flex gap-1 mb-3 flex-wrap">
        {labels.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              "px-3 py-1 text-xs rounded border transition-colors",
              active === t.key
                ? "bg-primary text-primary-fg border-primary"
                : "border-border bg-surface text-fg-soft hover:border-primary hover:text-primary"
            )}
          >
            {t.label} <span className="opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {active === "outstanding" || active === "upcoming" ? (
        <RentTable
          rows={group.rentRows.filter((r) => rentBucketOf(r, today, upcomingHorizon) === active)}
          active={active}
          canMarkRent={canMarkRent}
          markFullAction={markFullAction}
        />
      ) : active === "cost_due" ? (
        <CostTable
          rows={group.costRows.filter((c) => costBucketOf(c) === "cost_due")}
          today={today}
          canMarkRent={canMarkRent}
          markCostFullAction={markCostFullAction}
        />
      ) : (
        <CollectedTable
          canMarkRent={canMarkRent}
          items={[
            ...group.rentRows.filter((r) => r.status === "collected").map((r) => ({ kind: "rent" as const, row: r })),
            ...group.costRows.filter((c) => c.collection_status === "collected").map((c) => ({ kind: "cost" as const, row: c })),
          ].sort((a, b) => {
            const ad = (a.kind === "rent" ? a.row.collected_at : a.row.collected_at) ?? "";
            const bd = (b.kind === "rent" ? b.row.collected_at : b.row.collected_at) ?? "";
            return bd.localeCompare(ad);
          })}
        />
      )}
    </div>
  );
}

function RentTable({
  rows,
  active,
  canMarkRent,
  markFullAction,
}: {
  rows: RawRentRow[];
  active: "outstanding" | "upcoming";
  canMarkRent: boolean;
  markFullAction: (fd: FormData) => Promise<void>;
}) {
  const sorted = [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <div className="table-wrap rounded border border-border bg-surface">
      <table className="table">
        <thead>
          <tr>
            <th>Due date</th>
            <th>Property</th>
            <th className="text-right">Rent</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th>Status</th>
            {canMarkRent && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const p = pickOne(r.properties);
            const rem = rentRemainder(r);
            const statusLabel = r.status === "partial" ? "partial" : active === "outstanding" ? "overdue" : "due";
            const statusBadge = r.status === "partial" ? "badge-warning" : active === "outstanding" ? "badge-danger" : "badge-warning";
            return (
              <tr key={r.id}>
                <td>{fmtDate(r.due_date)}</td>
                <td>{p?.name}</td>
                <td className="text-right">{money(r.net_amount)}</td>
                <td className="text-right">{money(r.collected_amount)}</td>
                <td className={cn("text-right tabular-nums", rem > 0 && "text-danger font-medium")}>{money(rem)}</td>
                <td><span className={statusBadge}>{statusLabel}</span></td>
                {canMarkRent && (
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
          {!sorted.length && (
            <tr><td colSpan={canMarkRent ? 7 : 6} className="text-center text-muted-fg py-4">Nothing here.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CostTable({
  rows,
  today,
  canMarkRent,
  markCostFullAction,
}: {
  rows: RawCostRow[];
  today: string;
  canMarkRent: boolean;
  markCostFullAction: (fd: FormData) => Promise<void>;
}) {
  const sorted = [...rows].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  return (
    <div className="table-wrap rounded border border-border bg-surface">
      <table className="table">
        <thead>
          <tr>
            <th>Due date</th>
            <th>Description</th>
            <th>Categories</th>
            <th>Property</th>
            <th className="text-right">Total</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th>Status</th>
            {canMarkRent && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const lease = pickOne(c.leases);
            const p = pickOne(lease?.properties ?? null);
            const rem = costRemainder(c);
            const overdue = c.due_date <= today;
            const statusLabel = c.collection_status === "partial" ? "partial" : overdue ? "overdue" : "due";
            const statusBadge = c.collection_status === "partial" ? "badge-warning" : overdue ? "badge-danger" : "badge-warning";
            const lineItems = c.cost_line_items ?? [];
            return (
              <tr key={c.id}>
                <td>{fmtDate(c.due_date)}</td>
                <td>{c.description}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {lineItems.map((li, i) => (
                      <span key={i} className="badge-muted text-xs" title={`${money(li.amount)}`}>
                        {li.category} · {money(li.amount)}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{p?.name}</td>
                <td className="text-right">{money(c.amount)}</td>
                <td className="text-right">{money(c.collected_amount)}</td>
                <td className={cn("text-right tabular-nums", rem > 0 && "text-danger font-medium")}>{money(rem)}</td>
                <td><span className={statusBadge}>{statusLabel}</span></td>
                {canMarkRent && (
                  <td className="text-right">
                    <div className="flex gap-1 justify-end">
                      <form action={markCostFullAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-primary text-xs">Mark collected</button>
                      </form>
                      <Link href={`/costs/${c.id}/collect`} className="btn-secondary text-xs">Edit</Link>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={canMarkRent ? 9 : 8} className="text-center text-muted-fg py-4">No cost charges.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CollectedTable({ items, canMarkRent }: { items: CollectedItem[]; canMarkRent: boolean }) {
  return (
    <div className="table-wrap rounded border border-border bg-surface">
      <table className="table">
        <thead>
          <tr>
            <th>Collected on</th>
            <th>Type</th>
            <th>Property / Description</th>
            <th>Categories</th>
            <th className="text-right">Amount</th>
            {canMarkRent && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            if (it.kind === "rent") {
              const r = it.row;
              const p = pickOne(r.properties);
              return (
                <tr key={`rent-${r.id}`}>
                  <td>{fmtDate(r.collected_at)}</td>
                  <td><span className="badge-success">Rent</span></td>
                  <td>{p?.name}</td>
                  <td className="text-muted-fg text-xs">—</td>
                  <td className="text-right">{money(r.collected_amount)}</td>
                  {canMarkRent && (
                    <td className="text-right">
                      <Link href={`/rent/${r.id}/edit`} className="btn-secondary text-xs">Edit</Link>
                    </td>
                  )}
                </tr>
              );
            }
            const c = it.row;
            const lease = pickOne(c.leases);
            const p = pickOne(lease?.properties ?? null);
            const lineItems = c.cost_line_items ?? [];
            return (
              <tr key={`cost-${c.id}`}>
                <td>{fmtDate(c.collected_at)}</td>
                <td><span className="badge-warning">Cost</span></td>
                <td>
                  <div className="font-medium">{c.description}</div>
                  <div className="text-xs text-muted-fg">{p?.name}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {lineItems.map((li, i) => (
                      <span key={i} className="badge-muted text-xs">
                        {li.category} · {money(li.amount)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-right">{money(c.collected_amount)}</td>
                {canMarkRent && (
                  <td className="text-right">
                    <Link href={`/costs/${c.id}/collect`} className="btn-secondary text-xs">Edit</Link>
                  </td>
                )}
              </tr>
            );
          })}
          {!items.length && (
            <tr><td colSpan={canMarkRent ? 6 : 5} className="text-center text-muted-fg py-4">Nothing collected.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
