// Pure permission types and helpers — safe to import from both client and server components.
// Server-only helpers (getCurrentProfile, requirePermission) live in lib/permissions-server.ts.

export type ViewPermission =
  | "view_dashboard"
  | "view_compounds"
  | "view_properties"
  | "view_leases"
  | "view_rent"
  | "view_costs"
  | "view_service_charges";

export type ActionPermission =
  | "create_property"
  | "edit_property"
  | "delete_property"
  | "create_lease"
  | "cancel_lease"
  | "mark_rent"
  | "add_cost"
  | "delete_cost"
  | "pay_service_charges"
  | "manage_users";

export type Permission = ViewPermission | ActionPermission;

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  can_view_dashboard: boolean;
  can_view_compounds: boolean;
  can_view_properties: boolean;
  can_view_leases: boolean;
  can_view_rent: boolean;
  can_view_costs: boolean;
  can_view_service_charges: boolean;
  can_create_property: boolean;
  can_edit_property: boolean;
  can_delete_property: boolean;
  can_create_lease: boolean;
  can_cancel_lease: boolean;
  can_mark_rent: boolean;
  can_add_cost: boolean;
  can_delete_cost: boolean;
  can_pay_service_charges: boolean;
  can_manage_users: boolean;
  created_at: string;
};

export const FIELD_MAP: Record<Permission, keyof UserProfile> = {
  view_dashboard: "can_view_dashboard",
  view_compounds: "can_view_compounds",
  view_properties: "can_view_properties",
  view_leases: "can_view_leases",
  view_rent: "can_view_rent",
  view_costs: "can_view_costs",
  view_service_charges: "can_view_service_charges",
  create_property: "can_create_property",
  edit_property: "can_edit_property",
  delete_property: "can_delete_property",
  create_lease: "can_create_lease",
  cancel_lease: "can_cancel_lease",
  mark_rent: "can_mark_rent",
  add_cost: "can_add_cost",
  delete_cost: "can_delete_cost",
  pay_service_charges: "can_pay_service_charges",
  manage_users: "can_manage_users",
};

export function has(profile: UserProfile | null, perm: Permission): boolean {
  if (!profile) return false;
  if (profile.is_admin) return true;
  return Boolean(profile[FIELD_MAP[perm]]);
}

export function firstAllowedPath(profile: UserProfile | null): string {
  if (!profile) return "/login";
  if (has(profile, "view_dashboard")) return "/";
  if (has(profile, "view_compounds")) return "/compounds";
  if (has(profile, "view_properties")) return "/properties";
  if (has(profile, "view_leases")) return "/leases";
  if (has(profile, "view_rent")) return "/rent";
  if (has(profile, "view_costs")) return "/costs";
  if (has(profile, "view_service_charges")) return "/service-charges";
  if (has(profile, "manage_users")) return "/users";
  return "/no-access";
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_dashboard: "View dashboard",
  view_compounds: "View compounds page",
  view_properties: "View properties page",
  view_leases: "View leases page",
  view_rent: "View rent collection page",
  view_costs: "View costs page",
  view_service_charges: "View service charges page",
  create_property: "Create properties & compounds",
  edit_property: "Edit properties & compounds",
  delete_property: "Delete (archive) properties",
  create_lease: "Put on rent / edit leases",
  cancel_lease: "Cancel rentals",
  mark_rent: "Mark rent collected",
  add_cost: "Add / edit costs",
  delete_cost: "Delete costs",
  pay_service_charges: "Mark service charges paid / skipped",
  manage_users: "Manage users & permissions",
};

export const VIEW_PERMS: ViewPermission[] = [
  "view_dashboard", "view_compounds", "view_properties", "view_leases", "view_rent", "view_costs", "view_service_charges",
];
export const ACTION_PERMS: ActionPermission[] = [
  "create_property", "edit_property", "delete_property",
  "create_lease", "cancel_lease",
  "mark_rent",
  "add_cost", "delete_cost",
  "pay_service_charges",
  "manage_users",
];
