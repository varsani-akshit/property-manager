import "server-only";
import { supabaseAdmin } from "./supabase/admin";

/** Email-link types the /auth/confirm page accepts. */
export const LINK_TYPES = ["invite", "recovery", "magiclink", "signup", "email_change", "email"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const isLinkType = (t: unknown): t is LinkType => LINK_TYPES.includes(t as LinkType);

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Where Supabase sends people after its own /verify step (old-style links). */
export const callbackUrl = () => `${siteUrl()}/auth/callback`;

/**
 * Link to our confirm page. The token is only spent when the person presses
 * Continue there, so mail scanners that open links can't burn it.
 */
export function confirmUrl(tokenHash: string, type: LinkType) {
  return `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

/**
 * A fresh one-time sign-in link for someone who hasn't finished setting up:
 * an invite link while their email is unconfirmed, a password-reset link once
 * it is. Generating it replaces any earlier link for that person.
 */
export async function freshSetupLink(email: string): Promise<string> {
  const admin = supabaseAdmin();
  const inv = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: callbackUrl() } });
  if (!inv.error && inv.data.properties?.hashed_token) return confirmUrl(inv.data.properties.hashed_token, "invite");
  const rec = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: callbackUrl() } });
  if (rec.error || !rec.data.properties?.hashed_token) throw new Error(rec.error?.message ?? inv.error?.message ?? "Couldn't create a link");
  return confirmUrl(rec.data.properties.hashed_token, "recovery");
}

/** Plain-language version of Supabase's link errors. */
export function friendlyLinkError(msg: string | null | undefined): string {
  const m = (msg ?? "").toLowerCase();
  if (m.includes("expired") || m.includes("invalid") || m.includes("otp") || m.includes("not found")) {
    return "This link has expired or has already been used. Each link works once. Ask an admin for a new invite, or reset your password if you've set one before.";
  }
  return msg || "Something went wrong with this link.";
}
