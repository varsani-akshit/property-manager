"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";

/**
 * Debounced URL-replace search.
 * No form submit, no full reload — typing updates `?q=…` and triggers a soft
 * server fetch. The previous page stays painted until the new data arrives.
 */
export function SearchBar({
  placeholder = "Search…",
}: {
  placeholder?: string;
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
      // Reset pagination on a new search
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
    <div className="relative mb-4">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-fg pointer-events-none" />
      <input
        type="search"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="input pl-10 pr-10"
      />
      {(text || isPending) && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
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
