"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isLinkType } from "@/lib/auth-links";

/** Spends the one-time token from an email link and signs the person in. */
export async function confirmLink(formData: FormData) {
  const token_hash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!token_hash || !isLinkType(type)) redirect("/auth/confirm?error=missing");

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.verifyOtp({ token_hash, type });
  if (error) redirect(`/auth/confirm?error=${encodeURIComponent(error.code ?? error.message)}`);

  const needsPassword = type === "invite" || type === "recovery" || !data.user?.user_metadata?.password_set;
  redirect(needsPassword ? `/auth/set-password${type === "recovery" ? "?reset=1" : ""}` : "/");
}
