"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Modal dialog: title strip, scrolling body, optional footer. Escape and the backdrop close it. */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <div className={cn("relative w-full animate-fade-in rounded-lg border border-border bg-raised shadow-token-lg", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost !p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 text-[13px] text-fg-soft">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
