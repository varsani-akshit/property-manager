// Server-side page guard: redirects to first allowed page if user can't view this one.
import "server-only";
import { redirect } from "next/navigation";
import { has, firstAllowedPath, type ViewPermission, type UserProfile } from "./permissions";
import { getCurrentProfile } from "./permissions-server";

export async function guardView(perm: ViewPermission): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!has(profile, perm)) redirect(firstAllowedPath(profile));
  return profile;
}
