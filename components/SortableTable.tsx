"use client";
import { useMemo, useState, ReactNode } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Unified sortable table primitive.
 *
 * Alignment rules baked in via the column's `align` prop:
 *   - "left"   → text-left  (default, for names/text)
 *   - "right"  → text-right (for numbers/amounts)
 *   - "center" → text-center (for badges/status)
 *
 * Headers are always click-to-sort with a chevron indicator. Compare fn is
 * inferred (numbers vs strings vs Date-like ISOs) unless the column supplies
 * one explicitly.
 */
const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export type Alignment = "left" | "right" | "center";

export type Column<Row> = {
  key: string;
  label: string;
  align?: Alignment;
  /** How to extract the value for sorting. Defaults to row[key]. */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** Custom comparator, overrides default. */
  compare?: (a: Row, b: Row) => number;
  /** Cell renderer. Defaults to String(row[key]). */
  cell?: (row: Row) => ReactNode;
  /** Set false to disable sorting on this column. */
  sortable?: boolean;
  /** Optional class for the <th>. */
  headerClass?: string;
  /** Optional class for each <td>. */
  cellClass?: string;
  /** Fixed column width (e.g. "w-8", "w-32"). */
  width?: string;
};

type SortState = { key: string; dir: "asc" | "desc" };

function alignClass(a?: Alignment): string {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

function defaultCompare<Row>(col: Column<Row>, a: Row, b: Row): number {
  if (col.compare) return col.compare(a, b);
  const av = col.sortValue ? col.sortValue(a) : (a as any)[col.key];
  const bv = col.sortValue ? col.sortValue(b) : (b as any)[col.key];
  if (av == null && bv == null) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return nat.compare(String(av), String(bv));
}

export function SortableTable<Row>({
  rows,
  columns,
  rowKey,
  initialSort,
  onRowClick,
  emptyMessage = "No rows to show.",
  pageSize,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  initialSort?: SortState;
  onRowClick?: (row: Row) => void;
  emptyMessage?: string;
  pageSize?: number;
}) {
  const [sort, setSort] = useState<SortState | undefined>(initialSort);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const arr = [...rows];
    arr.sort((a, b) => defaultCompare(col, a, b));
    return sort.dir === "desc" ? arr.reverse() : arr;
  }, [rows, sort, columns]);

  const total = sorted.length;
  const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const start = pageSize ? (page - 1) * pageSize : 0;
  const view = pageSize ? sorted.slice(start, start + pageSize) : sorted;

  function toggle(key: string) {
    setPage(1);
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return undefined; // third click clears sort
    });
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    className={cn(
                      alignClass(c.align),
                      c.width,
                      c.headerClass,
                      sortable && "cursor-pointer select-none hover:text-primary"
                    )}
                    onClick={sortable ? () => toggle(c.key) : undefined}
                  >
                    <span className={cn(
                      "inline-flex items-center gap-1",
                      c.align === "right" && "flex-row-reverse"
                    )}>
                      {c.label}
                      {sortable && active && (sort!.dir === "asc" ? <ChevronUp size={12}/> : <ChevronDown size={12}/>)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(alignClass(c.align), c.cellClass)}>
                    {c.cell ? c.cell(row) : String((row as any)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!view.length && (
              <tr>
                <td colSpan={columns.length} className="text-center text-muted-fg py-8">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-fg">
          <span>Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}</span>
          <div className="flex gap-1">
            <button className="btn-secondary text-xs disabled:opacity-40" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
            <button className="btn-secondary text-xs disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
