import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { FIELD_MAP, VIEW_PERMS, ACTION_PERMS, type Permission, type UserProfile } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { SearchBar } from "@/components/SearchBar";
import { Team, type Member } from "./Team";

export const dynamic = "force-dynamic";

const ALL_PERMS: Permission[] = [...VIEW_PERMS, ...ACTION_PERMS];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requirePermission("manage_users");
  const q = (await searchParams).q?.trim() || "";

  const sb = await supabaseServer();
  let usersQ = sb.from("user_profiles").select("*");
  if (q) usersQ = usersQ.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
  const [allRes, authRes] = await Promise.all([
    usersQ.order("full_name", { ascending: true, nullsFirst: false }).order("email"),
    supabaseAdmin().auth.admin.listUsers({ perPage: 200 }).catch((e: Error) => {
      console.error("listUsers failed:", e.message);
      return { data: { users: [] } };
    }),
  ]);
  const profiles = (allRes.data ?? []) as unknown as UserProfile[];
  const auth = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));

  const members: Member[] = profiles.map((u) => {
    const a = auth.get(u.id);
    return {
      id: u.id,
      email: u.email,
      name: u.full_name && u.full_name.trim().toLowerCase() !== u.email.toLowerCase() ? u.full_name.trim() : null,
      isAdmin: u.is_admin,
      perms: ALL_PERMS.filter((p) => u[FIELD_MAP[p]]),
      status: !a ? "unknown" : a.last_sign_in_at ? "active" : a.email_confirmed_at ? "opened" : a.invited_at ? "invited" : "unknown",
      lastSignIn: a?.last_sign_in_at ?? null,
      joined: u.created_at,
      isMe: u.id === me.id,
    };
  });
  // Admins first, then by name.
  members.sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || (a.name || a.email).localeCompare(b.name || b.email));

  return (
    <div>
      <PageHeader title="Team" subtitle="Who can use Variaka, and what each person can see and do." right={<SearchBar placeholder="Search name or email…" />} />

      <div className="stat-row mb-6">
        <Kpi label="Members" value={String(members.length)} />
        <Kpi label="Active" value={String(members.filter((m) => m.status === "active").length)} hint="Have signed in" />
        <Kpi label="Pending" value={String(members.filter((m) => m.status === "invited" || m.status === "opened").length)} hint="Haven't finished setup" />
        <Kpi label="Admins" value={String(members.filter((m) => m.isAdmin).length)} />
      </div>

      <Team members={members} query={q} />
    </div>
  );
}
