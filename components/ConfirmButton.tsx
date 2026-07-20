"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { Loader2, AlertTriangle } from "lucide-react";

function InnerSubmit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending && <Loader2 size={14} className="animate-spin" />}
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
  // Autofocus the primary button when opened.
  if (typeof window !== "undefined" && open) {
    setTimeout(() => confirmRef.current?.focus(), 0);
  }
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg border border-border rounded-lg shadow-lg max-w-md w-full p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 mt-0.5 text-warning">
            <AlertTriangle size={20} />
          </div>
          <p className="text-sm whitespace-pre-line">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className="btn-danger text-sm">
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
  className = "btn-danger text-xs",
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
  className = "btn-danger text-xs",
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
