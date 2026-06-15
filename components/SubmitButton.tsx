"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * Submit button that disables itself + shows a spinner while the surrounding
 * <form action={…}> is in flight. Uses React's useFormStatus hook so it works
 * for any server action without prop-drilling.
 *
 *   <form action={createCost}>
 *     ...
 *     <SubmitButton>Save cost</SubmitButton>
 *   </form>
 */
export function SubmitButton({
  children,
  loadingText,
  className = "btn-primary",
}: {
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending && <Loader2 size={14} className="animate-spin" />}
      {pending ? (loadingText ?? "Saving…") : children}
    </button>
  );
}
