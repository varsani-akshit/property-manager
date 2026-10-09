"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Things inside a row that keep their own click (and so don't open the row). */
const OWN_CLICK = "a,button,input,select,textarea,label,summary,[role=button],[role=switch],[role=checkbox],[role=menuitem],[data-row-ignore]";

function rowFor(e: Event): HTMLElement | null {
  const t = e.target as Element | null;
  const row = t?.closest?.("[data-href]") as HTMLElement | null;
  if (!row) return null;
  const own = t!.closest(OWN_CLICK);
  if (own && own !== row && row.contains(own)) return null;
  return row;
}

/**
 * Makes any element with `data-href` (table rows, list items, cards) open that
 * page when clicked anywhere on it — one listener for the whole app, so
 * server-rendered tables only need `{...rowLink(href)}` (lib/row-link.ts). Cmd/Ctrl/Shift-click and
 * middle-click open a new tab, Enter opens a focused row, dragging to select
 * text doesn't navigate, and links/buttons/checkboxes inside keep working.
 * Rows are prefetched on hover.
 */
export function RowLinks() {
  const router = useRouter();
  useEffect(() => {
    const prefetched = new Set<string>();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const row = rowFor(e);
      if (!row) return;
      if (String(window.getSelection() ?? "").length > 0) return;
      const href = row.dataset.href!;
      if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, "_blank", "noopener");
      else router.push(href);
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const row = rowFor(e);
      if (!row) return;
      e.preventDefault();
      window.open(row.dataset.href!, "_blank", "noopener");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const row = e.target as HTMLElement;
      if (row?.dataset?.href) router.push(row.dataset.href);
    };
    const onOver = (e: MouseEvent) => {
      const row = (e.target as Element | null)?.closest?.("[data-href]") as HTMLElement | null;
      const href = row?.dataset.href;
      if (href && !prefetched.has(href)) { prefetched.add(href); router.prefetch(href); }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("auxclick", onAux);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mouseover", onOver, { passive: true });
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("auxclick", onAux);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mouseover", onOver);
    };
  }, [router]);
  return null;
}
