import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentProfile, PERMISSION_LABELS, requirePermission, type Permission, type UserProfile } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERM_KEYS = Object.keys(PERMISSION_LABELS) as Permission[];

async function updateUser(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();

  const patch: Partial<UserProfile> = {
    is_admin: formData.get("is_admin") === "on",
    can_create_property: formData.get("create_property") === "on",
    can_edit_property: formData.get("edit_property") === "on",
    can_delete_property: formData.get("delete_property") === "on",
    can_create_lease: formData.get("create_lease") === "on",
    can_cancel_lease: formData.get("cancel_lease") === "on",
    can_mark_rent: formData.get("mark_rent") === "on",
    can_add_cost: formData.get("add_cost") === "on",
    can_delete_cost: formData.get("delete_cost") === "on",
    can_manage_users: formData.get("manage_users") === "on",
  };
  await sb.from("user_profiles").update(patch).eq("id", id);
  revalidatePath("/users");
}

export default async function UsersPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin && !profile?.can_manage_users) {
    return <div className="card">Permission denied.</div>;
  }

  const sb = await supabaseServer();
  const { data: users } = await sb.from("user_profiles").select("*").order("created_at");

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

  return (
    <div>
      <PageHeader title="Users & permissions" subtitle="Toggle granular permissions per user. Admins implicitly have all permissions." />

      <div className="space-y-4">
        {users?.map((u: any) => (
          <form key={u.id} action={updateUser} className="card">
            <input type="hidden" name="id" value={u.id} />
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{u.full_name || u.email}</div>
                <div className="text-xs text-muted-fg">{u.email} · joined {fmtDate(u.created_at)}</div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_admin" defaultChecked={u.is_admin} />
                <span className="font-medium">Admin</span>
              </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {PERM_KEYS.map((p) => (
                <label key={p} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
                  <input
                    type="checkbox"
                    name={p}
                    defaultChecked={Boolean(u[FIELD_MAP[p]])}
                  />
                  <span>{PERMISSION_LABELS[p]}</span>
                </label>
              ))}
            </div>

            <div className="mt-3 flex justify-end">
              <button className="btn-primary text-sm">Save</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
