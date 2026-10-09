"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthLayout } from "@/components/brand/AuthLayout";
import { Loader } from "@/components/Loader";

function friendly(msg: string) {
  return /expired|invalid|otp/i.test(msg)
    ? "This link has expired or has already been used. Each link works once. Ask an admin for a new invite, or reset your password if you've set one before."
    : msg;
}

export function ClientCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : "";
        const params = new URLSearchParams(hash);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const errParam = params.get("error_description") || params.get("error");

        if (errParam) {
          setError(friendly(errParam));
          return;
        }
        if (!access_token || !refresh_token) {
          setError("This link is incomplete. Open it straight from the email, or ask an admin to send a new one.");
          return;
        }

        const sb = supabaseBrowser();
        const { error: setErr } = await sb.auth.setSession({ access_token, refresh_token });
        if (setErr) {
          setError(setErr.message);
          return;
        }

        // Wipe the hash so the URL doesn't keep leaking the tokens in history.
        window.history.replaceState({}, "", window.location.pathname);

        // Password resets and first-time users (invite, no password yet) → set-password.
        const { data: { user } } = await sb.auth.getUser();
        const passwordSet = Boolean(user?.user_metadata?.password_set);
        router.replace(params.get("type") === "recovery" ? "/auth/set-password?reset=1" : passwordSet ? "/" : "/auth/set-password");
        router.refresh();
      } catch (e) {
        setError((e as Error).message ?? "Failed to complete sign-in");
      }
    })();
  }, [router]);

  return (
    <AuthLayout
      title={error ? "This link didn't work" : "Signing you in"}
      subtitle={error ? undefined : "Hold on — setting up your session."}
    >
      {error ? (
        <div className="space-y-4">
          <div className="rounded-md bg-danger-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">{error}</div>
          <a href="/auth/forgot" className="btn-primary h-10 w-full !text-[13.5px]">Reset my password</a>
          <a href="/login" className="btn-secondary h-10 w-full">Back to sign in</a>
        </div>
      ) : (
        <div className="flex justify-center py-2"><Loader size="md" /></div>
      )}
    </AuthLayout>
  );
}
