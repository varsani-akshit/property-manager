import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AuthLayout } from "@/components/brand/AuthLayout";
import { getCurrentProfile } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <AuthLayout
        title="Profile not found"
        subtitle="Your user record is missing or your session expired. Ask an admin to add you, or sign in again."
      >
        <form action={async () => { "use server"; const sb = await supabaseServer(); await sb.auth.signOut(); redirect("/login"); }}>
          <button className="btn-secondary h-10 w-full">Sign out</button>
        </form>
      </AuthLayout>
    );
  }
  return <AppShell profile={profile}>{children}</AppShell>;
}
