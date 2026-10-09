"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Loader } from "./Loader";

function InnerSubmit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending && <Loader size="xs" tone="current" />}
      {pending ? "Working…" : label}
    </button>
  );
}

/**
 * App-styled confirm modal. Renders a portal overlay + centered dialog with
 * the same look as the rest of the app. Focus is trapped on the primary button,
 * Escape and backdrop click cancel.
 */
function ConfirmDialog({
  open,
  message,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  open: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 cursor-default"
        style={{ background: "var(--overlay)" }}
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md animate-fade-in rounded-lg border border-border bg-raised shadow-token-lg">
        <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
          <AlertTriangle size={15} className="shrink-0 text-warning" />
          <h2 className="text-[15px] font-semibold text-fg">Please confirm</h2>
        </div>
        <p className="whitespace-pre-line px-4 py-4 text-[13px] leading-relaxed text-fg-soft">{message}</p>
        <div className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className="btn-danger">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ConfirmButton({
  action,
  hiddenInputs = {},
  confirm: confirmMsg = "Are you sure?",
  label,
  className = "btn-danger-ghost",
  formClassName,
  confirmLabel,
}: {
  action: (fd: FormData) => Promise<void>;
  hiddenInputs?: Record<string, string>;
  confirm?: string;
  label: string;
  className?: string;
  formClassName?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={formRef}
        action={action}
        className={formClassName}
        onSubmit={(e) => {
          // Only intercept if the user hasn't confirmed yet.
          if (!(e.nativeEvent as SubmitEvent & { __confirmed?: boolean }).__confirmed) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {Object.entries(hiddenInputs).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <InnerSubmit label={label} className={className} />
      </form>
      <ConfirmDialog
        open={open}
        message={confirmMsg}
        confirmLabel={confirmLabel ?? label}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          // Requestor requestSubmit with a marker so onSubmit lets it through.
          const form = formRef.current;
          if (form) {
            form.addEventListener(
              "submit",
              (e) => { (e as SubmitEvent & { __confirmed?: boolean }).__confirmed = true; },
              { once: true, capture: true }
            );
            form.requestSubmit();
          }
        }}
      />
    </>
  );
}

export function ConfirmPostButton({
  action,
  confirm: confirmMsg = "Are you sure?",
  label,
  className = "btn-danger-ghost",
  confirmLabel,
}: {
  action: string;
  confirm?: string;
  label: string;
  className?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={formRef}
        method="post"
        action={action}
        onSubmit={(e) => {
          if (!(e.nativeEvent as SubmitEvent & { __confirmed?: boolean }).__confirmed) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <button type="submit" className={className}>{label}</button>
      </form>
      <ConfirmDialog
        open={open}
        message={confirmMsg}
        confirmLabel={confirmLabel ?? label}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          const form = formRef.current;
          if (form) {
            form.addEventListener(
              "submit",
              (e) => { (e as SubmitEvent & { __confirmed?: boolean }).__confirmed = true; },
              { once: true, capture: true }
            );
            form.requestSubmit();
          }
        }}
      />
    </>
  );
}
