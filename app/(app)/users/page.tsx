import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { PERMISSION_LABELS, VIEW_PERMS, ACTION_PERMS, type Permission, type UserProfile,  } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { Pagination, PAGE_SIZE, parsePage } from "@/components/Pagination";

export const dynamic = "force-dynamic";

function flash(key: "error" | "ok", msg: string): never {
  // Server-action helper: redirect back to /users with a flash message in the URL.
  redirect(`/users?${key}=${encodeURIComponent(msg)}`);
}

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
  if (!email) flash("error", "Email is required");

  const admin = supabaseAdmin();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/callback?next=/`,
  });
  if (error) flash("error", `Invite failed: ${error.message}`);
  revalidatePath("/users");
  flash("ok", `Invite sent to ${email}.`);
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
  const { error } = await sb.from("user_profiles").update(patch).eq("id", id);
  if (error) flash("error", `Update failed: ${error.message}`);
  revalidatePath("/users");
  flash("ok", "Permissions saved.");
}

async function resendInvite(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) flash("error", "Email required");
  const admin = supabaseAdmin();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/callback?next=/`,
  });
  if (error) flash("error", `Resend failed: ${error.message}`);
  revalidatePath("/users");
  flash("ok", `Invite re-sent to ${email}.`);
}

async function deleteUser(formData: FormData) {
  "use server";
  await requirePermission("manage_users");
  const id = String(formData.get("id"));
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) flash("error", `Delete failed: ${error.message}`);
  revalidatePath("/users");
  flash("ok", "User deleted.");
}

type AuthState = { invited_at: string | null; email_confirmed_at: string | null; last_sign_in_at: string | null };

function statusOf(s: AuthState | null): { label: string; cls: string } {
  if (!s) return { label: "unknown", cls: "badge-muted" };
  if (s.last_sign_in_at) return { label: "active", cls: "badge-success" };
  if (s.email_confirmed_at) return { label: "accepted (no password yet)", cls: "badge-warning" };
  if (s.invited_at) return { label: "invited — pending", cls: "badge-warning" };
  return { label: "no auth record", cls: "badge-muted" };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; page?: string }>;
}) {
  await guardView("view_dashboard"); // /users is gated below by manage_users
  await requirePermission("manage_users");

  const sp = await searchParams;
  const { error: flashError, ok: flashOk } = sp;
  const page = parsePage(sp.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = await supabaseServer();
  const admin = supabaseAdmin();

  const [pageRes, summaryRes, authResult] = await Promise.all([
    sb.from("user_profiles").select("*", { count: "exact" }).order("created_at").range(from, to),
    sb.from("user_profiles").select("id, is_admin"),
    admin.auth.admin.listUsers({ perPage: 200 }).catch((e: Error) => {
      console.error("listUsers failed:", e.message);
      return { data: { users: [] }, error: e } as any;
    }),
  ]);
  const users = (pageRes.data ?? []) as unknown as UserProfile[];
  const total = pageRes.count ?? 0;
  const allProfiles = (summaryRes.data ?? []) as Array<{ id: string; is_admin: boolean }>;

  const authById: Record<string, AuthState> = {};
  for (const u of authResult?.data?.users ?? []) {
    authById[u.id] = {
      invited_at: u.invited_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  }

  // KPIs computed across the whole user base (not the current page).
  const admins = allProfiles.filter((u) => u.is_admin).length;
  const invitedPending = allProfiles.filter((u) => {
    const a = authById[u.id];
    return a && a.invited_at && !a.last_sign_in_at;
  }).length;
  const active = allProfiles.filter((u) => authById[u.id]?.last_sign_in_at).length;

  return (
    <div>
      <PageHeader title="Users & permissions" subtitle="Invite teammates, toggle granular permissions. Admins implicitly have all permissions." />

      {flashError && (
        <div className="card mb-4 border-danger/30 bg-danger/5">
          <p className="text-sm text-danger">{flashError}</p>
          {flashError.toLowerCase().includes("rate limit") && (
            <p className="text-xs text-muted-fg mt-1">
              Supabase free tier limits invite emails (~3–4/hour). Wait a few minutes or configure a custom SMTP provider in Supabase → Authentication → Emails.
            </p>
          )}
        </div>
      )}
      {flashOk && (
        <div className="card mb-4 border-success/30 bg-success/5">
          <p className="text-sm text-success">{flashOk}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Users" value={String(total)} />
        <Kpi label="Active" value={String(active)} hint="Have signed in" />
        <Kpi label="Invited / pending" value={String(invitedPending)} hint="Haven't logged in yet" />
        <Kpi label="Admins" value={String(admins)} />
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
          <div key={u.id} className="card">
            {/* Single outer form for permission updates. Delete is a SIBLING form, never nested. */}
            <form action={updateUser}>
              <input type="hidden" name="id" value={u.id} />
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{u.full_name || u.email}</span>
                    {(() => { const s = statusOf(authById[u.id] ?? null); return <span className={s.cls}>{s.label}</span>; })()}
                  </div>
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

              <div className="mt-4 flex justify-end items-center gap-3">
                <span className="text-xs text-muted-fg">Joined {fmtDate(u.created_at)}</span>
                <button className="btn-primary text-sm">Save permissions</button>
              </div>
            </form>

            {/* Resend invite — shown when user is invited but hasn't signed in. Sibling form. */}
            {(() => {
              const a = authById[u.id];
              const pending = a && a.invited_at && !a.last_sign_in_at;
              if (!pending) return null;
              return (
                <form action={resendInvite} className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <input type="hidden" name="email" value={u.email} />
                  <p className="text-xs text-muted-fg flex-1">User hasn&apos;t accepted the invite yet.</p>
                  <button type="submit" className="btn-secondary text-xs">Resend invite</button>
                </form>
              );
            })()}

            {/* Separate, sibling form for delete — never nested inside the permissions form. */}
            <details className="mt-3 pt-3 border-t border-border">
              <summary className="text-xs text-danger cursor-pointer">Delete this user permanently</summary>
              <form action={deleteUser} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="id" value={u.id} />
                <p className="text-xs text-muted-fg flex-1">
                  Removes the auth user and their profile row. Cannot be undone.
                </p>
                <button type="submit" className="btn-danger text-xs">Permanently delete</button>
              </form>
            </details>
          </div>
        ))}
      </div>

      <div className="mt-4 card p-0">
        <Pagination page={page} total={total} label="users" searchParams={sp as Record<string, string | undefined>} />
      </div>
    </div>
  );
}
