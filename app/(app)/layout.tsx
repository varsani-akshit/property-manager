import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentProfile } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md w-full">
          <h1 className="font-semibold mb-2">Profile not found</h1>
          <p className="text-sm text-muted-fg mb-3">
            Your user record is missing or your session expired. Ask an admin to add you, or sign in again.
          </p>
          <form action={async () => { "use server"; const sb = await supabaseServer(); await sb.auth.signOut(); redirect("/login"); }}>
            <button className="btn-secondary text-sm">Sign out</button>
          </form>
        </div>
      </div>
    );
  }
  return <AppShell profile={profile}>{children}</AppShell>;
}
