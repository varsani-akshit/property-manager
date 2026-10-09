"use server";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidateApp } from "@/lib/revalidate";
import { newApiKey } from "@/lib/api-keys";

/** Issue a key for a user. The plain key is returned once and never stored. */
export async function createApiKey(input: { userId: string; name: string }): Promise<{ key?: string; error?: string }> {
  const me = await requirePermission("manage_users");
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: "Give the key a name, e.g. “Claude — laptop”." };
  const sb = await supabaseServer();
  const { data: owner } = await sb.from("user_profiles").select("id").eq("id", input.userId).maybeSingle();
  if (!owner) return { error: "Pick a user." };
  const { key, hash, prefix } = newApiKey();
  const { error } = await sb.from("api_keys").insert({ user_id: input.userId, name, prefix, key_hash: hash, created_by: me.id });
  if (error) return { error: error.message };
  revalidateApp("/admin/api-keys");
  return { key };
}

export async function revokeApiKey(formData: FormData) {
  await requirePermission("manage_users");
  const sb = await supabaseServer();
  await sb.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  revalidateApp("/admin/api-keys");
}
