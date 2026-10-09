"use client";
import { useRef } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type Align = "left" | "right" | "center";

/**
 * A clickable column header. Shows a faint ↕ on hover when unsorted and a
 * solid ↑/↓ when this column drives the order.
 */
export function SortTh({
  label,
  active,
  dir,
  onClick,
  align,
  className,
}: {
  label: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: Align;
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "th-sort group",
        active && "text-fg",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        <Icon
          size={11}
          strokeWidth={2}
          className={cn("shrink-0 transition-opacity", active ? "text-primary" : "opacity-0 group-hover:opacity-60")}
        />
      </span>
    </th>
  );
}

/** "1–25 of 120 · Page 1 of 5 ‹ ›" — the footer under a paged table. */
export function TablePager({
  page,
  pageSize,
  total,
  onPage,
  label,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Change page and bring the top of the table back into view.
  const go = (p: number) => {
    onPage(p);
    const box = ref.current?.closest(".card") ?? ref.current?.parentElement;
    if (box && box.getBoundingClientRect().top < 104) box.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div ref={ref} className={cn("flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-2.5 text-[12.5px] text-muted-fg", className)}>
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        {label ? ` ${label}` : ""}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <span className="mr-2 tabular-nums">Page {page} of {pages}</span>
          <PageButton disabled={page <= 1} onClick={() => go(page - 1)} label="Previous page">
            <ChevronLeft size={16} />
          </PageButton>
          <PageButton disabled={page >= pages} onClick={() => go(page + 1)} label="Next page">
            <ChevronRight size={16} />
          </PageButton>
        </div>
      )}
    </div>
  );
}

function PageButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-border p-1 text-fg-soft transition-colors hover:bg-muted hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
