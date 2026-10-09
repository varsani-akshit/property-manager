import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/**
 * The page's title strip: full width under a hairline, pinned to the top of the
 * scrolling panel.
 *
 * Pass `crumbs` to build a path like `Rent / Backfill / Godown No. 03`: the last
 * crumb is the page title, the ones before it are links shown above it (that's
 * how we replace "Back" buttons). For simple pages pass a single `title`.
 */
export function PageHeader({
  title,
  crumbs,
  subtitle,
  actions,
  right,
}: {
  title?: string;
  crumbs?: Crumb[];
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Inline right-side element (search box, filter dropdowns). Renders next to actions. */
  right?: React.ReactNode;
}) {
  const path: Crumb[] = crumbs ?? (title ? [{ label: title }] : []);
  const current = path[path.length - 1];
  const trail = path.slice(0, -1);

  return (
    <div className="z-20 -mx-4 mb-6 md:sticky md:top-0 flex flex-col gap-3 border-b border-border bg-surface/90 px-4 py-4 backdrop-blur-md sm:-mx-5 sm:px-5 md:-mx-8 md:flex-row md:items-center md:justify-between md:px-8 md:py-5">
      <div className="min-w-0">
        {trail.length > 0 && (
          <nav className="mb-1 flex min-w-0 flex-wrap items-center gap-1 text-[12.5px]" aria-label="Breadcrumb">
            {trail.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {c.href ? (
                  <Link href={c.href} className="truncate text-muted-fg transition-colors hover:text-fg">{c.label}</Link>
                ) : (
                  <span className="truncate text-muted-fg">{c.label}</span>
                )}
                <ChevronRight size={12} className="shrink-0 text-disabled" />
              </span>
            ))}
          </nav>
        )}
        {current && <h1 className="page-title truncate">{current.label}</h1>}
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {(right || actions) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {right}
          {actions}
        </div>
      )}
    </div>
  );
}
