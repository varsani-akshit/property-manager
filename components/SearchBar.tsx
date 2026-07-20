"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Inline, no-wrapper search that blends with the page background.
 *
 * URL-driven — typing updates `?q=…` after a debounce and triggers a soft
 * server fetch. Designed to sit in the PageHeader's `right` slot.
 */
export function SearchBar({
  placeholder = "Search…",
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  const [isPending, startTransition] = useTransition();
  const skipFirst = useRef(true);

  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    const t = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (text.trim()) params.set("q", text.trim());
      else params.delete("q");
      params.delete("page");
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function clear() {
    setText("");
    const params = new URLSearchParams(sp.toString());
    params.delete("q");
    params.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg pointer-events-none" />
      <input
        type="search"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full h-9 pl-9 pr-8 rounded bg-transparent border border-border text-sm placeholder:text-muted-fg
                   focus:outline-none focus:border-primary transition-colors"
      />
      {(text || isPending) && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isPending && <Loader2 size={14} className="animate-spin text-muted-fg" />}
          {text && !isPending && (
            <button type="button" onClick={clear} className="p-1 rounded hover:bg-muted" aria-label="Clear search">
              <X size={14} className="text-muted-fg" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
