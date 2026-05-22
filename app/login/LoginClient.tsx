"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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
      <div className="min-h-screen flex items-center justify-center bg-muted px-4">
        <div className="card max-w-sm w-full text-center">
          <p className="text-sm text-muted-fg">Completing sign-in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Rental Manager</h1>
          <p className="text-sm text-muted-fg">Sign in to continue.</p>
        </div>

        <div>
          <label className="label">Email</label>
          <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Please wait…" : "Sign in"}
        </button>

        <p className="text-xs text-muted-fg text-center">
          Access is invite-only. Ask your admin to invite you from the Users page.
        </p>
      </form>
    </div>
  );
}
