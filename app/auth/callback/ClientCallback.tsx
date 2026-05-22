"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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
          setError(errParam);
          return;
        }
        if (!access_token || !refresh_token) {
          setError("Missing tokens in the URL. Ask an admin to resend the invite.");
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

        // First-time users (invite, no password yet) → set-password.
        const { data: { user } } = await sb.auth.getUser();
        const passwordSet = Boolean(user?.user_metadata?.password_set);
        router.replace(passwordSet ? "/" : "/auth/set-password");
        router.refresh();
      } catch (e) {
        setError((e as Error).message ?? "Failed to complete sign-in");
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-sm w-full text-center space-y-2">
        <h1 className="font-semibold">Completing sign-in…</h1>
        {error ? (
          <>
            <p className="text-sm text-danger">{error}</p>
            <a href="/login" className="btn-secondary text-sm inline-flex">Back to sign in</a>
          </>
        ) : (
          <p className="text-sm text-muted-fg">Hold on — setting up your session.</p>
        )}
      </div>
    </div>
  );
}
