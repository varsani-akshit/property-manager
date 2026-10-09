"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { BellRing, ChevronRight, FileText, Search, X } from "lucide-react";
import { money, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SortTh, TablePager } from "@/components/TableBits";
import { PaymentDialog, type PayTarget } from "@/components/PaymentDialog";

type GroupSort = "default" | "lessee" | "outstanding" | "upcoming" | "collected";
const PAGE_SIZE = 25;
const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Selection + "record payment" shared by every table inside the accordion. */
type PayCtx = {
  canPay: boolean;
  selected: Map<string, PayTarget>;
  toggle: (t: PayTarget) => void;
  setMany: (ts: PayTarget[], on: boolean) => void;
  pay: (ts: PayTarget[]) => void;
};
const PayContext = createContext<PayCtx | null>(null);
const usePay = () => useContext(PayContext)!;
const keyOf = (t: { kind: string; id: string }) => `${t.kind}:${t.id}`;

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
}: {
  rentRows: RawRentRow[];
  costRows: RawCostRow[];
  depositShortfallByLessee: Record<string, number>;
  today: string;
  upcomingHorizon: string;
  canMarkRent: boolean;
}) {
  // ── selection + payment dialog ──
  const [selected, setSelected] = useState<Map<string, PayTarget>>(new Map());
  const [payTargets, setPayTargets] = useState<PayTarget[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const toggleSel = useCallback((t: PayTarget) => {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(keyOf(t))) next.delete(keyOf(t)); else next.set(keyOf(t), t);
      return next;
    });
  }, []);
  const setMany = useCallback((ts: PayTarget[], on: boolean) => {
    setSelected((cur) => {
      const next = new Map(cur);
      for (const t of ts) on ? next.set(keyOf(t), t) : next.delete(keyOf(t));
      return next;
    });
  }, []);
  const payCtx = useMemo<PayCtx>(
    () => ({ canPay: canMarkRent, selected, toggle: toggleSel, setMany, pay: setPayTargets }),
    [canMarkRent, selected, toggleSel, setMany]
  );
  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedTotal = selectedList.reduce((s, t) => s + t.owed, 0);

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
    <PayContext.Provider value={payCtx}>
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

    {selectedList.length > 0 && (
      <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 animate-fade-in items-center gap-3 rounded-xl border border-border bg-raised py-2 pl-4 pr-2 shadow-token-lg lg:left-[calc(50%+108px)]">
        <span className="whitespace-nowrap text-[12.5px] text-fg">
          <span className="font-medium">{selectedList.length} selected</span>
          <span className="text-muted-fg"> · {money(selectedTotal)} owed</span>
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Map())}>Clear</button>
        <button type="button" className="btn-primary btn-sm" onClick={() => setPayTargets(selectedList)}>
          Collect selected in full
        </button>
      </div>
    )}

    <PaymentDialog
      open={payTargets !== null}
      targets={payTargets ?? []}
      onClose={() => setPayTargets(null)}
      onDone={(msg) => {
        setToast(msg);
        setSelected(new Map());
      }}
    />
    {toast && (
      <div role="status" className="fixed bottom-5 left-1/2 z-[160] -translate-x-1/2 animate-fade-in rounded-lg bg-fg px-4 py-2.5 text-[12.5px] text-white shadow-token-lg">
        {toast}
      </div>
    )}
    </PayContext.Provider>
  );
}

function Tabs({
  group,
  today,
  upcomingHorizon,
  active,
  setActive,
}: {
  group: LesseeGroup;
  today: string;
  upcomingHorizon: string;
  active: Bucket;
  setActive: (t: Bucket) => void;
}) {
  const { canPay } = usePay();
  const labels: { key: Bucket; label: string; count: number }[] = [
    { key: "outstanding", label: "Due", count: group.outstanding_count },
    { key: "upcoming",   label: "Upcoming", count: group.upcoming_count },
    { key: "cost_due",   label: "Cost Due", count: group.cost_due_count },
    { key: "collected",  label: "Collected", count: group.collected_count },
  ];
  const q = encodeURIComponent(group.lessee_name);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist">
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
        <div className="flex items-center gap-1">
          <Link href={`/rent/statement?lessee=${q}`} className="btn-ghost btn-sm"><FileText size={13} /> Statement</Link>
          {canPay && <Link href={`/reminders?lessee=${q}`} className="btn-ghost btn-sm"><BellRing size={13} /> Remind</Link>}
        </div>
      </div>

      {active === "outstanding" || active === "upcoming" ? (
        <RentTable rows={group.rentRows.filter((r) => rentBucketOf(r, today, upcomingHorizon) === active)} active={active} lessee={group.lessee_name} />
      ) : active === "cost_due" ? (
        <CostTable rows={group.costRows.filter((c) => costBucketOf(c) === "cost_due")} today={today} lessee={group.lessee_name} />
      ) : (
        <CollectedTable
          canMarkRent={canPay}
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

/** Header checkbox that ticks/unticks every payable row in a table. */
function SelectAll({ targets }: { targets: PayTarget[] }) {
  const { selected, setMany } = usePay();
  const on = targets.length > 0 && targets.every((t) => selected.has(keyOf(t)));
  const some = targets.some((t) => selected.has(keyOf(t)));
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={on}
      disabled={!targets.length}
      ref={(el) => { if (el) el.indeterminate = !on && some; }}
      onChange={() => setMany(targets, !on)}
    />
  );
}

function RowSelect({ target }: { target: PayTarget }) {
  const { selected, toggle } = usePay();
  return <input type="checkbox" aria-label={`Select ${target.label}`} checked={selected.has(keyOf(target))} onChange={() => toggle(target)} />;
}

function RentTable({ rows, active, lessee }: { rows: RawRentRow[]; active: "outstanding" | "upcoming"; lessee: string }) {
  const { canPay, pay } = usePay();
  const sorted = [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const targetOf = (r: RawRentRow): PayTarget => ({
    kind: "rent", id: r.id, owed: rentRemainder(r),
    label: `Rent due ${fmtDate(r.due_date)} · ${pickOne(r.properties)?.name ?? lessee}`,
  });
  const targets = sorted.filter((r) => rentRemainder(r) > 0).map(targetOf);
  return (
    <div className="table-wrap rounded-lg border border-border bg-surface">
      <table className="table">
        <thead>
          <tr>
            {canPay && <th className="w-8"><SelectAll targets={targets} /></th>}
            <th>Due date</th>
            <th>Property</th>
            <th className="text-right">Rent</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th>Status</th>
            {canPay && <th></th>}
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
                {canPay && <td>{rem > 0 && <RowSelect target={targetOf(r)} />}</td>}
                <td>{fmtDate(r.due_date)}</td>
                <td>{p?.name}</td>
                <td className="text-right">{money(r.net_amount)}</td>
                <td className="text-right">{money(r.collected_amount)}</td>
                <td className={cn("text-right tabular-nums", rem > 0 && "text-danger font-medium")}>{money(rem)}</td>
                <td><span className={statusBadge}>{statusLabel}</span></td>
                {canPay && (
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {rem > 0 && <button type="button" className="btn-primary btn-sm" onClick={() => pay([targetOf(r)])}>Collect</button>}
                      <Link href={`/rent/${r.id}/edit`} className="btn-secondary btn-sm">Edit</Link>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={canPay ? 8 : 6} className="!py-10 text-center text-muted-fg">Nothing here.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CostTable({ rows, today, lessee }: { rows: RawCostRow[]; today: string; lessee: string }) {
  const { canPay, pay } = usePay();
  const sorted = [...rows].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const targetOf = (c: RawCostRow): PayTarget => ({
    kind: "cost", id: c.id, owed: costRemainder(c),
    label: `${c.description}${c.due_date ? ` · due ${fmtDate(c.due_date)}` : ""}`,
  });
  const targets = sorted.filter((c) => costRemainder(c) > 0).map(targetOf);
  return (
    <div className="table-wrap rounded-lg border border-border bg-surface">
      <table className="table">
        <thead>
          <tr>
            {canPay && <th className="w-8"><SelectAll targets={targets} /></th>}
            <th>Due date</th>
            <th>Description</th>
            <th>Categories</th>
            <th>Property</th>
            <th className="text-right">Total</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th>Status</th>
            {canPay && <th></th>}
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
                {canPay && <td>{rem > 0 && <RowSelect target={targetOf(c)} />}</td>}
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
                {canPay && (
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {rem > 0 && <button type="button" className="btn-primary btn-sm" onClick={() => pay([targetOf(c)])}>Collect</button>}
                      <Link href={`/costs/${c.id}/collect`} className="btn-secondary btn-sm">Edit</Link>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr><td colSpan={canPay ? 10 : 8} className="!py-10 text-center text-muted-fg">No cost charges.</td></tr>
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
