// Server-only permission helpers. Do not import from client components.
import "server-only";
import { cache } from "react";
import { supabaseServer } from "./supabase/server";
import { has, type Permission, type UserProfile } from "./permissions";

// React.cache() dedupes within a single request: if 3 different server components
// call getCurrentProfile(), the auth + DB lookup runs exactly once.
export const getCurrentProfile = cache(async (): Promise<UserProfile | null> => {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data } = await sb.from("user_profiles").select("*").eq("id", user.id).maybeSingle();
  if (data) return data as UserProfile;

  const fullName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
  const { data: inserted } = await sb
    .from("user_profiles")
    .insert({ id: user.id, email: user.email ?? "", full_name: fullName })
    .select("*")
    .maybeSingle();
  return (inserted as UserProfile) ?? null;
});

export async function requirePermission(perm: Permission): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!has(profile, perm)) {
    throw new Error(`Permission denied: ${perm}`);
  }
  return profile!;
}
