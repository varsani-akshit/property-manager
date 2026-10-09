import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 25;

/**
 * Server-side pagination footer: "1–25 of 120 rows · Page 1 of 5 ‹ ›".
 * Preserves all other URL params (multi-table pages can use a distinct paramName per table).
 */
export function Pagination({
  page,
  total,
  paramName = "page",
  searchParams = {},
  label = "rows",
  pageSize = PAGE_SIZE,
}: {
  page: number;
  total: number;
  paramName?: string;
  searchParams?: Record<string, string | string[] | undefined>;
  label?: string;
  pageSize?: number;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const makeHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === "string") params.set(k, v);
    }
    if (target === 1) params.delete(paramName);
    else params.set(paramName, String(target));
    const q = params.toString();
    return q ? `?${q}` : "?";
  };

  const btn = "rounded-md border border-border p-1 text-fg-soft transition-colors hover:bg-muted hover:text-fg";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-2.5 text-[12.5px] text-muted-fg">
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {label}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <span className="mr-2 tabular-nums">Page {page} of {totalPages}</span>
          {page > 1 ? (
            <Link href={makeHref(page - 1)} scroll={false} className={btn} aria-label="Previous page"><ChevronLeft size={16} /></Link>
          ) : (
            <span className={`${btn} pointer-events-none opacity-40`} aria-hidden><ChevronLeft size={16} /></span>
          )}
          {page < totalPages ? (
            <Link href={makeHref(page + 1)} scroll={false} className={btn} aria-label="Next page"><ChevronRight size={16} /></Link>
          ) : (
            <span className={`${btn} pointer-events-none opacity-40`} aria-hidden><ChevronRight size={16} /></span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Parse a numeric page param safely. Defaults to 1.
 */
export function parsePage(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
