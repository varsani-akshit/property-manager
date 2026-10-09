"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: title strip, scrolling body, optional footer. Escape and the
 * backdrop close it; the page behind doesn't scroll while it's open; focus
 * moves into it, stays inside on Tab, and returns to where it was on close.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const scroller = document.getElementById("main-scroll");
    const prevOverflow = scroller?.style.overflow;
    if (scroller) scroller.style.overflow = "hidden";

    // First field gets focus — except on touch screens, where that would pop
    // the keyboard over the dialog; there the dialog itself takes focus.
    requestAnimationFrame(() => {
      const body = panel.current?.querySelector<HTMLElement>("[data-dialog-body]");
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const first = (!touch && body?.querySelector<HTMLElement>(FOCUSABLE)) || panel.current;
      first?.focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (scroller) scroller.style.overflow = prevOverflow ?? "";
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 cursor-default animate-[fade-in_0.15s_ease-out_both]" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full animate-fade-in flex-col rounded-t-2xl border border-border bg-raised shadow-token-lg outline-none sm:max-h-[85vh] sm:rounded-lg",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
          <h2 className="min-w-0 text-[15px] font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 !p-1.5" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-[13px] text-fg-soft">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line-subtle px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
