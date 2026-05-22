import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Handles redirects from Supabase email links (invites, magic links, password resets).
// Exchanges the one-time code for a session, then routes to /auth/set-password
// for first-time users (no password yet) or to "/" for everyone else.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const sb = await supabaseServer();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url));
  }

  const { data: { user } } = await sb.auth.getUser();
  // First-time invitees haven't set a password yet — we tag them in user_metadata
  // after they do. If the flag is missing, send them to set-password first.
  const passwordSet = Boolean(user?.user_metadata?.password_set);
  if (!passwordSet) {
    return NextResponse.redirect(new URL("/auth/set-password", req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
