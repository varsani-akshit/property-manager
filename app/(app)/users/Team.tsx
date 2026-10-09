"use client";
import { useMemo, useState, useTransition } from "react";
import { Check, Mail, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import { Loader } from "@/components/Loader";
import { ACTION_PERMS, VIEW_PERMS, type Permission } from "@/lib/permissions";
import { deleteUser, inviteUser, resendInvite, savePermissions } from "./actions";
import { SetupLink } from "./SetupLink";

export type Member = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  perms: Permission[];
  status: "active" | "invited" | "opened" | "unknown";
  lastSignIn: string | null;
  joined: string;
  isMe: boolean;
};

// ─── What can be granted, grouped the way the app is laid out ───────────────

const AREAS: { label: string; hint?: string; view: Permission | null; actions: [Permission, string][] }[] = [
  { label: "Dashboard", hint: "Analytics and insights", view: "view_dashboard", actions: [] },
  { label: "Compounds", view: "view_compounds", actions: [] },
  { label: "Properties", hint: "Create and edit cover compounds too", view: "view_properties", actions: [["create_property", "Create"], ["edit_property", "Edit"], ["delete_property", "Archive"]] },
  { label: "Leases", view: "view_leases", actions: [["create_lease", "Create & edit"], ["cancel_lease", "Cancel"]] },
  { label: "Rent collection", hint: "Also payments, statements, reminders", view: "view_rent", actions: [["mark_rent", "Record payments"]] },
  { label: "Costs", view: "view_costs", actions: [["add_cost", "Add & edit"], ["delete_cost", "Delete"]] },
  { label: "Service charges", view: "view_service_charges", actions: [["pay_service_charges", "Mark paid / skipped"]] },
  { label: "Team", hint: "Invite people and change access", view: null, actions: [["manage_users", "Manage team"]] },
];

const PRESETS: { key: string; label: string; desc: string; admin?: boolean; perms: Permission[] }[] = [
  { key: "viewer", label: "Viewer", desc: "Sees every page, changes nothing", perms: [...VIEW_PERMS] },
  { key: "collector", label: "Rent collector", desc: "Leases and rent; records payments", perms: ["view_leases", "view_rent", "mark_rent"] },
  {
    key: "manager", label: "Manager", desc: "Day-to-day work; no deleting or team changes",
    perms: [...VIEW_PERMS, "create_property", "edit_property", "create_lease", "cancel_lease", "mark_rent", "add_cost", "pay_service_charges"],
  },
  { key: "admin", label: "Admin", desc: "Everything, including the team", admin: true, perms: [] },
];

const sameSet = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p));
function presetOf(isAdmin: boolean, perms: Permission[]) {
  if (isAdmin) return PRESETS.find((p) => p.admin)!;
  return PRESETS.find((p) => !p.admin && sameSet(p.perms, perms)) ?? null;
}
function roleLabel(m: Pick<Member, "isAdmin" | "perms">) {
  const p = presetOf(m.isAdmin, m.perms);
  if (p) return p.label;
  if (!m.perms.length) return "No access";
  if (m.perms.length === VIEW_PERMS.length + ACTION_PERMS.length) return "Full access";
  const pages = m.perms.filter((x) => x.startsWith("view_")).length;
  return `Custom · ${pages} page${pages === 1 ? "" : "s"}, ${m.perms.length - pages} action${m.perms.length - pages === 1 ? "" : "s"}`;
}

const initials = (m: Member) =>
  (m.name || m.email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");

const STATUS: Record<Member["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "badge-success" },
  invited: { label: "Invite pending", cls: "badge-warning" },
  opened: { label: "No password yet", cls: "badge-warning" },
  unknown: { label: "No sign-in", cls: "badge-muted" },
};

function ago(iso: string | null) {
  if (!iso) return "Never";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1 / 24) return "Just now";
  if (d < 1) return `${Math.floor(d * 24)}h ago`;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Page body ──────────────────────────────────────────────────────────────

export function Team({ members, query }: { members: Member[]; query: string }) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  return (
    <>
      <div className="card p-0">
        <div className="section-head">
          <div className="min-w-0">
            <h2>Members</h2>
            <p className="text-[11.5px] text-muted-fg">Click someone to change what they can see and do.</p>
          </div>
          <button type="button" className="btn-primary h-8" onClick={() => setInviting(true)}>
            <UserPlus size={14} /> Invite
          </button>
        </div>
        <ul className="divide-y divide-line-subtle">
          {members.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setEditing(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-medium", m.isAdmin ? "bg-primary text-white" : "bg-primary-soft text-primary")}>
                  {initials(m)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-fg">{m.name || m.email}</span>
                    {m.isMe && <span className="badge-muted shrink-0">You</span>}
                  </span>
                  <span className="block truncate text-[12px] text-muted-fg">
                    {m.name ? m.email : null}
                    <span className={cn("sm:hidden", m.name && "before:content-['_·_']")}>{roleLabel(m)}</span>
                  </span>
                </span>
                <span className="hidden w-48 shrink-0 truncate text-[12.5px] text-fg-soft sm:block">
                  {m.isAdmin && <ShieldCheck size={13} className="-mt-0.5 mr-1 inline text-primary" />}
                  {roleLabel(m)}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-[12px] text-muted-fg md:block">{m.status === "active" ? ago(m.lastSignIn) : ""}</span>
                <span className="w-[7.5rem] shrink-0 text-right max-sm:w-auto">
                  <span className={STATUS[m.status].cls}>{STATUS[m.status].label}</span>
                </span>
              </button>
            </li>
          ))}
          {!members.length && (
            <li className="px-4 py-10 text-center text-[13px] text-muted-fg">
              {query ? <>No one matches &ldquo;{query}&rdquo;.</> : "No members yet."}
            </li>
          )}
        </ul>
      </div>

      {editing && <AccessDialog member={editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); flash(msg); }} />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={(msg) => { setInviting(false); flash(msg); }} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[160] -translate-x-1/2 animate-fade-in rounded-lg bg-fg px-4 py-2.5 text-[12.5px] text-white shadow-token-lg">{toast}</div>}
    </>
  );
}

// ─── Access editor ──────────────────────────────────────────────────────────

function AccessEditor({ isAdmin, perms, onChange }: { isAdmin: boolean; perms: Permission[]; onChange: (isAdmin: boolean, perms: Permission[]) => void }) {
  const set = useMemo(() => new Set(perms), [perms]);
  const preset = presetOf(isAdmin, perms);
  const toggle = (p: Permission) => onChange(false, set.has(p) ? perms.filter((x) => x !== p) : [...perms, p]);

  return (
    <div className="space-y-4">
      <div>
        <div className="kpi-label mb-2">Role</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map((p) => {
            const on = preset?.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(!!p.admin, p.admin ? perms : [...p.perms])}
                className={cn("rounded-lg border px-3 py-2.5 text-left transition-colors", on ? "border-primary bg-primary-soft" : "border-border hover:border-line-strong hover:bg-muted/40")}
              >
                <span className="flex items-center justify-between gap-1 text-[13px] font-medium text-fg">
                  {p.label}
                  {on && <Check size={13} className="text-primary" />}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-fg">{p.desc}</span>
              </button>
            );
          })}
        </div>
        {!preset && <p className="mt-2 text-[11.5px] text-muted-fg">Custom access — adjusted below.</p>}
      </div>

      {isAdmin ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-primary-soft px-3.5 py-3 text-[12.5px] text-fg-soft">
          <ShieldCheck size={16} className="mt-px shrink-0 text-primary" />
          <span>Admins can see and do everything, including inviting people and changing access. Pick another role to limit what they can do.</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] gap-4 border-b border-line-subtle bg-muted/40 px-3.5 py-2 sm:grid">
            <span className="kpi-label">Area</span>
            <span className="kpi-label w-14 text-center">Can see</span>
            <span className="kpi-label">Can do</span>
          </div>
          <ul className="divide-y divide-line-subtle">
            {AREAS.map((a) => {
              const seen = a.view ? set.has(a.view) : true;
              return (
                <li key={a.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)]">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-fg">{a.label}</span>
                    {a.hint && <span className="block text-[11.5px] text-muted-fg">{a.hint}</span>}
                  </span>
                  <span className="flex w-14 justify-center">
                    {a.view ? <Switch on={set.has(a.view)} onClick={() => toggle(a.view!)} label={`See ${a.label}`} /> : <span className="text-[12px] text-disabled">—</span>}
                  </span>
                  <span className={cn("col-span-2 flex flex-wrap gap-1.5 sm:col-span-1", !seen && "opacity-50")}>
                    {a.actions.length ? a.actions.map(([p, label]) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={set.has(p)}
                        onClick={() => toggle(p)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors",
                          set.has(p) ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-muted-fg hover:border-line-strong hover:text-fg"
                        )}
                      >
                        {set.has(p) ? <Check size={12} /> : <Plus size={12} />}{label}
                      </button>
                    )) : <span className="text-[12px] text-disabled max-sm:hidden">View only</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-line-strong")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left]", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function AccessDialog({ member: m, onClose, onDone }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const [isAdmin, setIsAdmin] = useState(m.isAdmin);
  const [perms, setPerms] = useState<Permission[]>(m.perms);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const dirty = isAdmin !== m.isAdmin || !sameSet(perms, m.perms);

  const run = (fn: () => Promise<{ ok?: string; error?: string }>, close = true) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else if (close) onDone(r.ok ?? "Done");
      else setNote(r.ok ?? null);
    });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={<span className="flex min-w-0 flex-col"><span className="truncate">{m.name || m.email}</span>{m.name && <span className="truncate text-[12px] font-normal text-muted-fg">{m.email}</span>}</span>}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {!m.isMe && (confirmDelete ? (
            <span className="flex items-center gap-2 text-[12px]">
              <span className="text-danger">Remove {m.name || m.email}?</span>
              <button type="button" className="btn-danger h-8" disabled={pending} onClick={() => run(() => deleteUser(m.id))}>Remove</button>
              <button type="button" className="btn-ghost h-8" onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="btn-ghost h-8 text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Remove
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" className="btn-secondary h-8" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary h-8" disabled={!dirty || pending} onClick={() => run(() => savePermissions(m.id, isAdmin, perms))}>
            {pending && <Loader size="xs" tone="current" />} Save access
          </button>
        </div>
      }
    >
      {(m.status === "invited" || m.status === "opened") && (
        <div className="mb-4 space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3">
          <p className="text-[12.5px] text-fg-soft">
            {m.status === "opened" ? "They opened the invite but haven't set a password yet." : "They haven't accepted the invite yet."} Send the email again, or copy a one-time link to send another way.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary h-8" disabled={pending} onClick={() => run(() => resendInvite(m.email, m.status === "opened"), false)}>
              <Mail size={13} /> Resend email
            </button>
            <SetupLink email={m.email} />
          </div>
          {note && <p className="text-[12px] text-success">{note}</p>}
        </div>
      )}
      <AccessEditor isAdmin={isAdmin} perms={perms} onChange={(a, p) => { setIsAdmin(a); setPerms(p); }} />
      {m.isMe && <p className="mt-3 text-[11.5px] text-muted-fg">This is you. You can&apos;t remove your own admin access or delete yourself.</p>}
      {error && <div className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}
    </Dialog>
  );
}

// ─── Invite ─────────────────────────────────────────────────────────────────

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<Permission[]>([...VIEW_PERMS]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    setError(null);
    const r = await inviteUser(email, isAdmin, perms);
    if (r.error) setError(r.error); else onDone(r.ok ?? "Invite sent.");
  });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Invite a member"
      footer={
        <>
          <button type="button" className="btn-secondary h-8" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary h-8" disabled={pending || !email} onClick={submit}>
            {pending && <Loader size="xs" tone="current" />} Send invite
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mb-5">
        <label className="label" htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="input h-10" />
        <p className="mt-1.5 text-[11.5px] text-muted-fg">They get an email to set a password. If it doesn&apos;t arrive, open their card and use Copy link.</p>
      </form>
      <AccessEditor isAdmin={isAdmin} perms={perms} onChange={(a, p) => { setIsAdmin(a); setPerms(p); }} />
      {error && <div className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}
    </Dialog>
  );
}
