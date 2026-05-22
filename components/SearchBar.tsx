import Link from "next/link";

/**
 * Server-rendered search bar. Submits via GET, so the search term lives in
 * `?q=...` and is bookmarkable / shareable.
 *
 * `searchParams` lets us preserve other query params on the page (filters, etc.).
 */
export function SearchBar({
  placeholder = "Search…",
  q,
  searchParams = {},
}: {
  placeholder?: string;
  q?: string;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return (
    <form action="" method="get" className="card mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
      {/* Preserve other params (except q + any page params we want to reset on a new search) */}
      {Object.entries(searchParams)
        .filter(([k]) => k !== "q" && !k.endsWith("page"))
        .map(([k, v]) =>
          typeof v === "string" ? <input key={k} type="hidden" name={k} value={v} /> : null
        )}
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder={placeholder}
        className="input flex-1"
      />
      <div className="flex gap-2">
        <button className="btn-primary text-sm">Search</button>
        {q && <Link href="?" className="btn-secondary text-sm">Clear</Link>}
      </div>
    </form>
  );
}
