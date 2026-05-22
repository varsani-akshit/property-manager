import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { getCurrentProfile } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // getCurrentProfile() is React.cache()'d — both this call and any guardView()
  // in child server components share the same single DB lookup.
  const profile = await getCurrentProfile();
  if (!profile) {
    // No session at all — redirect. Middleware should have caught this but be safe.
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-md">
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

  return (
    <div className="flex min-h-screen">
      <Sidebar profile={profile} />
      <main className="flex-1 min-w-0 p-6 bg-muted/30">{children}</main>
    </div>
  );
}
