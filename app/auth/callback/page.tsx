import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ClientCallback } from "./ClientCallback";

/**
 * Handles Supabase auth email-link landings. Supports both flows:
 *  - PKCE: ?code=... (server can exchange directly)
 *  - Implicit / invite-with-hash: #access_token=...&refresh_token=...
 *    (fragment is never sent to server, so we render a client component
 *     that reads the hash and calls auth.setSession)
 */
export default async function CallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string; error?: string; error_description?: string }>;
}) {
  const sp = await searchParams;

  if (sp.error) {
    redirect(`/login?error=${encodeURIComponent(sp.error_description ?? sp.error)}`);
  }

  if (sp.code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(sp.code);
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
    const { data: { user } } = await sb.auth.getUser();
    const passwordSet = Boolean(user?.user_metadata?.password_set);
    if (!passwordSet) redirect("/auth/set-password");
    redirect(sp.next ?? "/");
  }

  // No code in query → must be a fragment-based invite. Let client JS handle it.
  return <ClientCallback />;
}
