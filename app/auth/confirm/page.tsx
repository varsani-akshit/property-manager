import { AuthLayout } from "@/components/brand/AuthLayout";
import { SubmitButton } from "@/components/SubmitButton";
import { friendlyLinkError, isLinkType, type LinkType } from "@/lib/auth-links";
import { confirmLink } from "./actions";

const COPY: Record<LinkType, { title: string; subtitle: string; button: string }> = {
  invite: { title: "You're invited", subtitle: "You've been added to Variaka. Continue to choose your password.", button: "Accept and continue" },
  recovery: { title: "Reset your password", subtitle: "Continue to choose a new password.", button: "Continue" },
  magiclink: { title: "Sign in", subtitle: "Continue to sign in to Variaka.", button: "Sign in" },
  signup: { title: "Confirm your email", subtitle: "Continue to confirm your email address.", button: "Confirm email" },
  email: { title: "Confirm your email", subtitle: "Continue to confirm your email address.", button: "Confirm email" },
  email_change: { title: "Confirm new email", subtitle: "Continue to switch your account to this address.", button: "Confirm" },
};

/**
 * Landing page for links in Variaka's auth emails. Opening the page spends
 * nothing; the token is used only when the person presses the button, so
 * link scanners and previews can't use it up first.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; error?: string }> }) {
  const sp = await searchParams;

  if (sp.error || !sp.token_hash || !isLinkType(sp.type)) {
    const message = sp.error && sp.error !== "missing" ? friendlyLinkError(sp.error) : "This link is incomplete. Open it straight from the email, or ask an admin to send a new one.";
    return (
      <AuthLayout title="This link didn't work">
        <div className="space-y-4">
          <div className="rounded-md bg-danger-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">{message}</div>
          <a href="/auth/forgot" className="btn-primary h-10 w-full !text-[13.5px]">Reset my password</a>
          <a href="/login" className="btn-secondary h-10 w-full">Back to sign in</a>
        </div>
      </AuthLayout>
    );
  }

  const copy = COPY[sp.type];
  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle}>
      <form action={confirmLink}>
        <input type="hidden" name="token_hash" value={sp.token_hash} />
        <input type="hidden" name="type" value={sp.type} />
        <SubmitButton className="btn-primary h-10 w-full !text-[13.5px]" loadingText="Checking link…">{copy.button}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
