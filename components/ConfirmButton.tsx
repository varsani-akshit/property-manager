"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

function InnerSubmit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending && <Loader2 size={14} className="animate-spin" />}
      {pending ? "Working…" : label}
    </button>
  );
}

export function ConfirmButton({
  action,
  hiddenInputs = {},
  confirm: confirmMsg = "Are you sure?",
  label,
  className = "btn-danger text-xs",
  formClassName,
}: {
  action: (fd: FormData) => Promise<void>;
  hiddenInputs?: Record<string, string>;
  confirm?: string;
  label: string;
  className?: string;
  formClassName?: string;
}) {
  return (
    <form
      action={action}
      className={formClassName}
      onSubmit={(e) => {
        if (!window.confirm(confirmMsg)) e.preventDefault();
      }}
    >
      {Object.entries(hiddenInputs).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <InnerSubmit label={label} className={className} />
    </form>
  );
}

export function ConfirmPostButton({
  action,
  confirm: confirmMsg = "Are you sure?",
  label,
  className = "btn-danger text-xs",
}: {
  action: string;
  confirm?: string;
  label: string;
  className?: string;
}) {
  return (
    <form
      method="post"
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMsg)) e.preventDefault();
      }}
    >
      {/* For plain POST routes, button just disables during natural form submit via :disabled trick */}
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}
