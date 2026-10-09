"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthLayout } from "@/components/brand/AuthLayout";
import { Loader } from "@/components/Loader";

export default function SetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace("/login");
      else setEmail(user.email ?? null);
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.updateUser({
      password,
      data: { password_set: true },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthLayout
      title="Set your password"
      subtitle={<>Welcome{email ? `, ${email}` : ""}. Choose a password to finish setting up your account.</>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" type="password" required minLength={8} autoComplete="new-password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="mt-1 block text-[11.5px] text-muted-fg">At least 8 characters.</span>
        </div>
        <div>
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" required minLength={8} autoComplete="new-password" className="input h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary h-10 w-full !text-[13.5px]">
          {loading && <Loader size="xs" tone="current" />}
          {loading ? "Saving…" : "Set password and continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
