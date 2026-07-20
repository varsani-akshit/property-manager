import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/**
 * Breadcrumb-style page header.
 *
 * Pass `crumbs` to build a path like `Rent / Backfill / Godown No. 03`. The
 * last crumb is the current page (bold, not a link). Any crumb with an `href`
 * is clickable — that's how we replace "Back" buttons.
 *
 * For simple pages, pass a single `title` and it becomes the sole crumb.
 */
export function PageHeader({
  title,
  crumbs,
  actions,
  right,
}: {
  title?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  /** Inline right-side element (search box, filter dropdowns). Renders next to actions. */
  right?: React.ReactNode;
}) {
  const path: Crumb[] = crumbs ?? (title ? [{ label: title }] : []);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
      <nav className="min-w-0 flex items-center gap-1 text-sm font-medium tracking-tight flex-wrap" aria-label="Breadcrumb">
        {path.map((c, i) => {
          const isLast = i === path.length - 1;
          const cls = isLast
            ? "text-fg truncate"
            : "text-muted-fg hover:text-fg transition-colors";
          return (
            <span key={i} className="flex items-center gap-1 min-w-0">
              {c.href && !isLast ? (
                <Link href={c.href} className={cls}>{c.label}</Link>
              ) : (
                <span className={cls}>{c.label}</span>
              )}
              {!isLast && <ChevronRight size={12} className="text-muted-fg shrink-0" />}
            </span>
          );
        })}
      </nav>
      {(right || actions) && (
        <div className="flex gap-2 flex-wrap items-center shrink-0">
          {right}
          {actions}
        </div>
      )}
    </div>
  );
}
