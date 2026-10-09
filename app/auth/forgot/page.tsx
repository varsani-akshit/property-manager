import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/brand/AuthLayout";
import { SubmitButton } from "@/components/SubmitButton";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callbackUrl } from "@/lib/auth-links";

async function sendReset(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/auth/forgot");
  // Same answer whether or not the address has an account.
  const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() });
  if (error && (error.status === 429 || /rate/i.test(error.message))) redirect("/auth/forgot?error=rate");
  if (error) console.error("password reset failed:", error.message);
  redirect("/auth/forgot?sent=1");
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  if (sp.sent) {
    return (
      <AuthLayout title="Check your email" subtitle="If that address has a Variaka account, a link to reset the password is on its way. It works once.">
        <a href="/login" className="btn-secondary h-10 w-full">Back to sign in</a>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter your work email and we'll send you a link to choose a new password."
      footer={<a href="/login" className="hover:text-fg">Back to sign in</a>}
    >
      <form action={sendReset} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input h-10" />
        </div>
        {sp.error === "rate" && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">Too many emails were sent just now. Wait a few minutes and try again.</div>}
        <SubmitButton className="btn-primary h-10 w-full !text-[13.5px]" loadingText="Sending…">Send reset link</SubmitButton>
      </form>
    </AuthLayout>
  );
}
