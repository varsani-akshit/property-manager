"use server";
import { requirePermission } from "@/lib/permissions-server";
import { FIELD_MAP, VIEW_PERMS, ACTION_PERMS, type Permission, type UserProfile } from "@/lib/permissions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidateApp } from "@/lib/revalidate";
import { callbackUrl, freshSetupLink } from "@/lib/auth-links";

type Result = { ok?: string; error?: string };
const ALL: Permission[] = [...VIEW_PERMS, ...ACTION_PERMS];

/** Invite someone and give them their access straight away. */
export async function inviteUser(email: string, isAdmin: boolean, perms: Permission[]): Promise<Result> {
  await requirePermission("manage_users");
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "Enter a valid email address." };
  const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(e, { redirectTo: callbackUrl() });
  if (error) return { error: /already been registered|exists/i.test(error.message) ? `${e} already has an account.` : error.message };
  // The profile row is created by a trigger on auth.users (supabase/schema.sql).
  const set = await savePermissions(data.user.id, isAdmin, perms);
  revalidateApp("/users");
  return set.error ? { ok: `Invite sent to ${e}, but access wasn't saved: ${set.error}` } : { ok: `Invite sent to ${e}.` };
}

export async function savePermissions(id: string, isAdmin: boolean, perms: Permission[]): Promise<Result> {
  const me = await requirePermission("manage_users");
  if (isAdmin && !me.is_admin) return { error: "Only admins can make someone an admin." };
  if (id === me.id && !isAdmin && me.is_admin) return { error: "You can't remove your own admin access." };
  const set = new Set(perms);
  const patch: Partial<Record<keyof UserProfile, boolean>> = { is_admin: isAdmin };
  for (const p of ALL) patch[FIELD_MAP[p]] = set.has(p);
  const { error } = await (await supabaseServer()).from("user_profiles").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidateApp("/users");
  return { ok: "Access saved." };
}

/**
 * Re-send the setup email. An unconfirmed invite can be re-sent; once the
 * email is confirmed (link opened, no password yet) Supabase refuses a second
 * invite, so a set-password email goes instead.
 */
export async function resendInvite(email: string, confirmed: boolean): Promise<Result> {
  await requirePermission("manage_users");
  const admin = supabaseAdmin();
  const { error } = confirmed
    ? await admin.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() })
    : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: callbackUrl() });
  if (error) return { error: /rate/i.test(error.message) ? "Too many emails sent just now. Try again in a few minutes, or use Copy link." : error.message };
  return { ok: `Email sent to ${email}.` };
}

/**
 * A one-time setup link an admin can send over WhatsApp/SMS when email is
 * slow or the emailed link was used up. It replaces any earlier link.
 */
export async function getSetupLink(email: string): Promise<{ url?: string; error?: string }> {
  await requirePermission("manage_users");
  try {
    return { url: await freshSetupLink(email.trim().toLowerCase()) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteUser(id: string): Promise<Result> {
  const me = await requirePermission("manage_users");
  if (id === me.id) return { error: "You can't delete your own account." };
  const { error } = await supabaseAdmin().auth.admin.deleteUser(id);
  if (error) return { error: error.message };
  revalidateApp("/users");
  return { ok: "User removed." };
}
