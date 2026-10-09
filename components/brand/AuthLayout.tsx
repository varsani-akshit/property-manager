import type { ReactNode } from "react";
import { PlanGround } from "./PlanGround";
import { Wordmark } from "../Logo";

/** Sign-in, set-password and callback screens: the wordmark top-left and one card on the drafting-sheet ground. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-sunken">
      <PlanGround className="pointer-events-none fixed inset-0" />
      <div className="relative z-10 shrink-0 px-7 pt-6">
        <a href="/login" aria-label="Variaka">
          <Wordmark />
        </a>
      </div>
      <div className="relative z-10 flex flex-1 items-start justify-center px-4 pb-16 pt-[10vh] sm:items-center sm:pt-0">
        <div className="w-full max-w-[380px] animate-fade-in rounded-2xl border border-border bg-surface/95 px-8 pb-8 pt-9 shadow-[0_12px_40px_-12px_rgba(30,30,80,0.18)] backdrop-blur">
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.025em] text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 border-t border-line-subtle pt-4 text-center text-[12px] text-muted-fg">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
