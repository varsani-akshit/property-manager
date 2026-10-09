"use client";
import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import { money, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SortTh, TablePager } from "@/components/TableBits";
import { SubmitButton } from "@/components/SubmitButton";

type GroupSort = "default" | "lessee" | "outstanding" | "upcoming" | "collected";
const PAGE_SIZE = 25;
const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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

  // Search, sort and paging over the lessee groups (client-side; the server already scoped the rows).
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: GroupSort; dir: "asc" | "desc" }>({ key: "default", dir: "asc" });
  const [page, setPage] = useState(1);

  const outstandingOf = (g: LesseeGroup) => g.outstanding_total + g.cost_due_total + g.deposit_shortfall;

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? groups.filter((g) =>
          g.lessee_name.toLowerCase().includes(q) ||
          g.compound.toLowerCase().includes(q) ||
          g.properties.some((p) => p.toLowerCase().includes(q)) ||
          (g.contact ?? "").toLowerCase().includes(q))
      : groups;
    if (sort.key === "default") return list;
    const arr = [...list];
    arr.sort((a, b) => {
      const cmp =
        sort.key === "lessee" ? nat.compare(a.lessee_name, b.lessee_name)
        : sort.key === "outstanding" ? outstandingOf(a) - outstandingOf(b)
        : sort.key === "upcoming" ? a.upcoming_total - b.upcoming_total
        : a.collected_total - b.collected_total;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [groups, query, sort]);

  useEffect(() => setPage(1), [query, sort]);
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function sortBy(key: GroupSort) {
    setSort((cur) =>
      cur.key !== key ? { key, dir: key === "lessee" ? "asc" : "desc" }
      : cur.dir === (key === "lessee" ? "asc" : "desc") ? { key, dir: key === "lessee" ? "desc" : "asc" }
      : { key: "default", dir: "asc" } // third click: back to compound / property order
    );
  }

  return (
    <div className="card p-0">
      <div className="section-head flex-wrap">
        <h2>
          Lessees
          <span className="ml-2 text-[12px] font-normal text-muted-fg">
            {view.length === groups.length ? groups.length : `${view.length} of ${groups.length}`}
          </span>
        </h2>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
          <input
            className="input h-8 !pl-8 !pr-8"
            placeholder="Search lessee, property, compound…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-fg hover:bg-muted" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8"></th>
              <SortTh label="Lessee · Property" active={sort.key === "lessee"} dir={sort.dir} onClick={() => sortBy("lessee")} />
              <SortTh label="Total outstanding" align="right" active={sort.key === "outstanding"} dir={sort.dir} onClick={() => sortBy("outstanding")} />
              <SortTh label="Upcoming (6 mo)" align="right" active={sort.key === "upcoming"} dir={sort.dir} onClick={() => sortBy("upcoming")} />
              <SortTh label="Collected (4 mo)" align="right" active={sort.key === "collected"} dir={sort.dir} onClick={() => sortBy("collected")} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((g) => {
              const isOpen = open.has(g.lessee_name);
              const activeTab: Bucket = tabs[g.lessee_name] ?? "outstanding";
              const totalOutstanding = outstandingOf(g);
              return (
                <Fragment key={g.lessee_name}>
                  <tr
                    onClick={() => toggle(g.lessee_name)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(g.lessee_name); } }}
                    tabIndex={0}
                    aria-expanded={isOpen}
                    className={cn("cursor-pointer", isOpen && "[&>td]:bg-muted/40")}
                  >
                    <td className="text-muted-fg">
                      <ChevronRight size={14} className={cn("transition-transform duration-150", isOpen && "rotate-90 text-fg")} />
                    </td>
                    <td className="max-w-md">
                      <div className="font-medium">{g.lessee_name}</div>
                      <div className="mt-0.5 truncate text-[12px] text-muted-fg" title={g.properties.join(", ")}>
                        {g.properties.join(", ") || (g.contact ?? "")}
                      </div>
                    </td>
                    <td className={cn("text-right font-medium tabular-nums", totalOutstanding > 0 && "text-danger")}>
                      {money(totalOutstanding)}
                      {totalOutstanding > 0 && (
                        <div className="mt-0.5 text-[11px] font-normal text-muted-fg">
                          {g.outstanding_total > 0 && <>rent {money(g.outstanding_total)}</>}
                          {g.cost_due_total > 0 && <> · cost {money(g.cost_due_total)}</>}
                          {g.deposit_shortfall > 0 && <> · dep {money(g.deposit_shortfall)}</>}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {money(g.upcoming_total)}
                      {g.upcoming_count > 0 && <span className="ml-1 text-[11.5px] text-muted-fg">({g.upcoming_count})</span>}
                    </td>
                    <td className="text-right tabular-nums text-success">
                      {money(g.collected_total)}
                      {g.collected_count > 0 && <span className="ml-1 text-[11.5px] text-muted-fg">({g.collected_count})</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="[&>td]:!bg-sunken/60">
                      <td colSpan={5} className="!px-4 !py-3">
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
            {!pageRows.length && (
              <tr>
                <td colSpan={5} className="!py-10 text-center text-muted-fg">
                  {query ? `No lessees match "${query}".` : "No rent or cost activity in the current scope."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager page={page} pageSize={PAGE_SIZE} total={view.length} onPage={setPage} label="lessees" />
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
      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist">
        {labels.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] transition-colors",
              active === t.key ? "bg-surface font-medium text-fg shadow-token-sm ring-1 ring-border" : "text-muted-fg hover:text-fg"
            )}
          >
            {t.label}
            <span className="text-[11px] tabular-nums text-muted-fg">{t.count}</span>
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
    <div className="table-wrap rounded-lg border border-border bg-surface">
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
                        <SubmitButton className="btn-primary btn-sm" loadingText="Saving…">Mark collected</SubmitButton>
                      </form>
                      <Link href={`/rent/${r.id}/edit`} className="btn-secondary btn-sm">Edit</Link>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={canMarkRent ? 7 : 6} className="!py-10 text-center text-muted-fg">Nothing here.</td></tr>
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
    <div className="table-wrap rounded-lg border border-border bg-surface">
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
                      <span key={i} className="badge-muted" title={`${money(li.amount)}`}>
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
                        <SubmitButton className="btn-primary btn-sm" loadingText="Saving…">Mark collected</SubmitButton>
                      </form>
                      <Link href={`/costs/${c.id}/collect`} className="btn-secondary btn-sm">Edit</Link>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={canMarkRent ? 9 : 8} className="!py-10 text-center text-muted-fg">No cost charges.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CollectedTable({ items, canMarkRent }: { items: CollectedItem[]; canMarkRent: boolean }) {
  return (
    <div className="table-wrap rounded-lg border border-border bg-surface">
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
                  <td className="text-muted-fg">—</td>
                  <td className="text-right">{money(r.collected_amount)}</td>
                  {canMarkRent && (
                    <td className="text-right">
                      <Link href={`/rent/${r.id}/edit`} className="btn-secondary btn-sm">Edit</Link>
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
                  <div className="mt-0.5 text-[12px] text-muted-fg">{p?.name}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {lineItems.map((li, i) => (
                      <span key={i} className="badge-muted">
                        {li.category} · {money(li.amount)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-right">{money(c.collected_amount)}</td>
                {canMarkRent && (
                  <td className="text-right">
                    <Link href={`/costs/${c.id}/collect`} className="btn-secondary btn-sm">Edit</Link>
                  </td>
                )}
              </tr>
            );
          })}
          {!items.length && (
            <tr><td colSpan={canMarkRent ? 6 : 5} className="!py-10 text-center text-muted-fg">Nothing collected.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
