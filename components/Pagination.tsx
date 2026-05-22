import Link from "next/link";

export const PAGE_SIZE = 25;

/**
 * Server-side pagination control.
 * Renders "Showing X–Y of Z" plus Prev/Next page links.
 *
 * Preserves all other URL params (e.g. multi-table pages can use distinct paramName per table).
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

  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-fg border-t border-border">
      <div>
        Showing <span className="font-medium text-fg">{from.toLocaleString()}–{to.toLocaleString()}</span> of <span className="font-medium text-fg">{total.toLocaleString()}</span> {label}
      </div>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={makeHref(page - 1)} className="btn-secondary text-xs">‹ Prev</Link>
        ) : (
          <span className="btn-secondary text-xs opacity-40 pointer-events-none">‹ Prev</span>
        )}
        <span className="px-2">Page {page} / {totalPages}</span>
        {page < totalPages ? (
          <Link href={makeHref(page + 1)} className="btn-secondary text-xs">Next ›</Link>
        ) : (
          <span className="btn-secondary text-xs opacity-40 pointer-events-none">Next ›</span>
        )}
      </div>
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
