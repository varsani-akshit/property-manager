// Granular permission flags stored on user_profiles.
// Admins implicitly have every permission.

import { supabaseServer } from "./supabase/server";

export type Permission =
  | "create_property"
  | "edit_property"
  | "delete_property"
  | "create_lease"
  | "cancel_lease"
  | "mark_rent"
  | "add_cost"
  | "delete_cost"
  | "manage_users";

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  can_create_property: boolean;
  can_edit_property: boolean;
  can_delete_property: boolean;
  can_create_lease: boolean;
  can_cancel_lease: boolean;
  can_mark_rent: boolean;
  can_add_cost: boolean;
  can_delete_cost: boolean;
  can_manage_users: boolean;
};

const FIELD_MAP: Record<Permission, keyof UserProfile> = {
  create_property: "can_create_property",
  edit_property: "can_edit_property",
  delete_property: "can_delete_property",
  create_lease: "can_create_lease",
  cancel_lease: "can_cancel_lease",
  mark_rent: "can_mark_rent",
  add_cost: "can_add_cost",
  delete_cost: "can_delete_cost",
  manage_users: "can_manage_users",
};

export function has(profile: UserProfile | null, perm: Permission): boolean {
  if (!profile) return false;
  if (profile.is_admin) return true;
  return Boolean(profile[FIELD_MAP[perm]]);
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data } = await sb.from("user_profiles").select("*").eq("id", user.id).maybeSingle();
  if (data) return data as UserProfile;

  // Fallback: trigger may not have fired (or RLS hid the row). Try to create it.
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
  const { data: inserted } = await sb
    .from("user_profiles")
    .insert({ id: user.id, email: user.email ?? "", full_name: fullName })
    .select("*")
    .maybeSingle();
  return (inserted as UserProfile) ?? null;
}

export async function requirePermission(perm: Permission): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!has(profile, perm)) {
    throw new Error(`Permission denied: ${perm}`);
  }
  return profile!;
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  create_property: "Create properties",
  edit_property: "Edit properties",
  delete_property: "Delete properties",
  create_lease: "Put properties on rent",
  cancel_lease: "Cancel rentals",
  mark_rent: "Mark rent collected",
  add_cost: "Add costs",
  delete_cost: "Delete costs",
  manage_users: "Manage users & permissions",
};
