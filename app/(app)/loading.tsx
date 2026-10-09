import { Loader } from "@/components/Loader";

/** Route transition: the title strip and a faint outline of the page, with the skyline loader. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="-mx-4 mb-6 flex items-center justify-between border-b border-border px-4 py-5 sm:-mx-5 sm:px-5 md:-mx-8 md:px-8">
        <div className="h-6 w-44 animate-pulse rounded-md bg-muted" />
        <Loader size="sm" />
      </div>

      <div className="stat-row mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi">
            <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-6 w-28 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="section-head">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-6 border-b border-line-subtle px-4 py-3 last:border-0" style={{ opacity: 1 - i * 0.11 }}>
            <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-48 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-3.5 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
