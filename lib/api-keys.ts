import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import type { UserProfile } from "./permissions";

/**
 * API keys for the MCP endpoint. A key looks like `vk_<43 url-safe chars>`;
 * only its SHA-256 is stored (public.api_keys), plus a short prefix so people
 * can tell keys apart. Each key acts as — and has exactly the permissions of —
 * the user it was issued to.
 */
export const KEY_PREFIX = "vk_";

export function newApiKey() {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashKey(key), prefix: key.slice(0, 10) };
}

export function hashKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Resolve a presented key to its (active) owner, or null. Records last use (at most once a minute). */
export async function verifyApiKey(key: string | null | undefined): Promise<{ profile: UserProfile; keyId: string } | null> {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length < 40 || key.length > 100) return null;
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at, last_used_at, user_profiles(*)")
    .eq("key_hash", hashKey(key))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  const profile = (Array.isArray(data.user_profiles) ? data.user_profiles[0] : data.user_profiles) as UserProfile | null;
  if (!profile) return null;
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 60_000) {
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { profile, keyId: data.id as string };
}
