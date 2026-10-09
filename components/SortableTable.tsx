"use client";
import { useEffect, useMemo, useState, ReactNode } from "react";
import { rowLink } from "@/lib/row-link";
import { cn } from "@/lib/cn";
import { SortTh, TablePager } from "./TableBits";

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
  /** Hide this column on phones (secondary detail). */
  hideOnMobile?: boolean;
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
  rowHref,
  emptyMessage = "No rows to show.",
  pageSize,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  initialSort?: SortState;
  onRowClick?: (row: Row) => void;
  /** Page the row opens (whole row clickable, new tab with Cmd/Ctrl/middle-click). */
  rowHref?: (row: Row) => string | undefined;
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

  // Back to page 1 when the rows change (search, filters).
  useEffect(() => setPage(1), [rows]);

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
              {columns.map((c) =>
                c.sortable === false ? (
                  <th key={c.key} className={cn(alignClass(c.align), c.width, c.headerClass, c.hideOnMobile && "hidden sm:table-cell")}>{c.label}</th>
                ) : (
                  <SortTh
                    key={c.key}
                    label={c.label}
                    active={sort?.key === c.key}
                    dir={sort?.key === c.key ? sort.dir : "asc"}
                    onClick={() => toggle(c.key)}
                    align={c.align}
                    className={cn(c.width, c.headerClass, c.hideOnMobile && "hidden sm:table-cell")}
                  />
                )
              )}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                {...rowLink(rowHref?.(row))}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(alignClass(c.align), c.cellClass, c.hideOnMobile && "hidden sm:table-cell")}>
                    {c.cell ? c.cell(row) : String((row as any)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!view.length && (
              <tr>
                <td colSpan={columns.length} className="!py-10 text-center text-muted-fg">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageSize && total > pageSize && (
        <TablePager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}
    </div>
  );
}
