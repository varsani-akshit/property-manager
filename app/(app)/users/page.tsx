import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { PERMISSION_LABELS, VIEW_PERMS, ACTION_PERMS, type Permission, type UserProfile,  } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const FIELD_MAP: Record<Permission, keyof UserProfile> = {
  view_dashboard: "can_view_dashboard",
  view_compounds: "can_view_compounds",
  view_properties: "can_view_properties",
  view_leases: "can_view_leases",
  view_rent: "can_view_rent",
  view_costs: "can_view_costs",
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

const ALL_PERMS: Permission[] = [...VIEW_PERMS, ...ACTION_PERMS];

async function inviteUser(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) throw new Error("Email is required");

  const admin = supabaseAdmin();
  // Send invite email — user clicks link, sets password, gets logged in.
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/login`,
  });
  if (error) throw new Error(error.message);
  // user_profiles row will be created automatically by the on_auth_user_created trigger.
  revalidatePath("/users");
}

async function updateUser(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();

  const patch: Partial<Record<keyof UserProfile, boolean>> = {
    is_admin: formData.get("is_admin") === "on",
  };
  for (const p of ALL_PERMS) {
    patch[FIELD_MAP[p]] = formData.get(p) === "on";
  }
  await sb.from("user_profiles").update(patch).eq("id", id);
  revalidatePath("/users");
}

async function deleteUser(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const id = String(formData.get("id"));
  const admin = supabaseAdmin();
  // Remove from auth (cascades to user_profiles via FK)
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  revalidatePath("/users");
}

export default async function UsersPage() {
  await guardView("view_dashboard"); // /users is gated below by manage_users
  await requirePermission("manage_users");

  const sb = await supabaseServer();
  const { data } = await sb.from("user_profiles").select("*").order("created_at");
  const users = (data ?? []) as unknown as UserProfile[];

  const admins = users.filter((u) => u.is_admin).length;

  return (
    <div>
      <PageHeader title="Users & permissions" subtitle="Invite teammates, toggle granular permissions. Admins implicitly have all permissions." />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="Users" value={String(users.length)} />
        <Kpi label="Admins" value={String(admins)} />
        <Kpi label="Standard users" value={String(users.length - admins)} />
      </div>

      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Invite a user</h2>
        <form action={inviteUser} className="flex gap-2">
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@company.com"
            className="input flex-1"
          />
          <button className="btn-primary">Send invite</button>
        </form>
        <p className="text-xs text-muted-fg mt-2">
          They&apos;ll get an email with a magic link to set their password. Once they sign in, come back here to grant
          permissions.
        </p>
      </div>

      <div className="space-y-4">
        {users.map((u) => (
          <form key={u.id} action={updateUser} className="card">
            <input type="hidden" name="id" value={u.id} />
            <div className="flex items-center justify-between mb-3 gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.full_name || u.email}</div>
                <div className="text-xs text-muted-fg truncate">{u.email}</div>
              </div>
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                <input type="checkbox" name="is_admin" defaultChecked={u.is_admin} />
                <span className="font-medium">Admin</span>
              </label>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-fg mb-2">Page visibility</div>
                <div className="space-y-1 text-sm">
                  {VIEW_PERMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
                      <input type="checkbox" name={p} defaultChecked={Boolean(u[FIELD_MAP[p]])} />
                      <span>{PERMISSION_LABELS[p]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-fg mb-2">Actions</div>
                <div className="space-y-1 text-sm">
                  {ACTION_PERMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
                      <input type="checkbox" name={p} defaultChecked={Boolean(u[FIELD_MAP[p]])} />
                      <span>{PERMISSION_LABELS[p]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-between items-center">
              <details>
                <summary className="text-xs text-danger cursor-pointer">Delete user</summary>
                <form action={deleteUser} className="mt-2">
                  <input type="hidden" name="id" value={u.id} />
                  <button type="submit" className="btn-danger text-xs">Permanently delete</button>
                </form>
              </details>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-fg">Joined {fmtDate(u.created_at)}</span>
                <button className="btn-primary text-sm">Save</button>
              </div>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
