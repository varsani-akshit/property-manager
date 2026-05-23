"use client";

/**
 * Wraps a single-button form with a confirm() prompt before submitting a server action.
 * Use for any destructive operation (delete, archive, cancel).
 *
 *   <ConfirmButton action={deleteCost} hiddenInputs={{ id: c.id }} confirm="Delete this cost?" label="Delete" />
 */
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
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}

/**
 * Same idea but for plain <form method=POST action="/api/..."> (not server actions).
 * Used for the cancel-lease route handler.
 */
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
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}
