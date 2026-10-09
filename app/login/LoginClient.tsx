"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthLayout } from "@/components/brand/AuthLayout";
import { Loader } from "@/components/Loader";

export function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(sp.get("error"));
  const [loading, setLoading] = useState(false);
  const [hashHandled, setHashHandled] = useState(false);

  // If we landed here from a legacy invite link that put tokens in the URL hash
  // (Supabase fell back to /login because /auth/callback wasn't on the redirect
  // allowlist), redirect to /auth/callback so the proper handler can process it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash) { setHashHandled(true); return; }
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("access_token") || params.get("error_description")) {
      const newUrl = `/auth/callback${window.location.hash}`;
      window.location.replace(newUrl);
      return;
    }
    setHashHandled(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else { router.push("/"); router.refresh(); }
  }

  if (!hashHandled) {
    return (
      <AuthLayout title="Signing you in" subtitle="Completing sign-in…">
        <div className="flex justify-center py-2"><Loader size="md" /></div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your Variaka account."
      footer={<>No account? Ask an admin to invite you.</>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">Password</label>
            <a href="/auth/forgot" className="text-[12px] text-muted-fg hover:text-primary">Forgot password?</a>
          </div>
          <input id="password" type="password" required autoComplete="current-password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}

        <button type="submit" disabled={loading} className="btn-primary h-10 w-full !text-[13.5px]">
          {loading && <Loader size="xs" tone="current" />}
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
