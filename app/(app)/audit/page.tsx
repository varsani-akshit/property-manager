import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { SearchBar } from "@/components/SearchBar";
import { Pagination, parsePage } from "@/components/Pagination";
import { getCurrentProfile } from "@/lib/permissions-server";
import { has, firstAllowedPath } from "@/lib/permissions";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const PAGE = 50;
const ENTITIES: Record<string, string> = {
  payments: "Payment",
  rent_collections: "Rent row",
  costs: "Cost",
  leases: "Lease",
  lease_rent_changes: "Rent change",
  properties: "Property",
  compounds: "Compound",
  service_charges: "Service charge",
  reminders: "Reminder",
  user_profiles: "User",
  api_keys: "API key",
};
const LINK: Record<string, (id: string) => string> = {
  leases: (id) => `/leases/${id}`,
  properties: (id) => `/properties/${id}`,
  compounds: (id) => `/compounds/${id}`,
  rent_collections: (id) => `/rent/${id}/edit`,
};
// Fields not worth showing in a diff
const HIDE = new Set(["id", "created_by", "updated_at", "legacy", "lessee_pays_service_charge", "deposit_amount", "service_charge_deduction"]);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 16).replace("T", " ");
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; actor?: string; q?: string; page?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!has(profile, "manage_users")) redirect(firstAllowedPath(profile));
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const entity = sp.entity && ENTITIES[sp.entity] ? sp.entity : "";
  const actor = sp.actor ?? "";
  const q = sp.q?.trim() ?? "";

  const sb = await supabaseServer();
  let query = sb.from("audit_log").select("*", { count: "exact" }).order("at", { ascending: false });
  if (entity) query = query.eq("entity", entity);
  if (actor === "system") query = query.is("actor_id", null);
  else if (actor) query = query.eq("actor_id", actor);
  if (q) query = query.ilike("label", `%${q}%`);
  const [{ data, count }, { data: people }] = await Promise.all([
    query.range((page - 1) * PAGE, page * PAGE - 1),
    sb.from("user_profiles").select("id, full_name, email").order("email"),
  ]);
  const rows = (data ?? []) as any[];

  const filterHref = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ entity, actor, q, ...patch })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Every change to rent, payments, leases, properties, costs and users — who made it and when." right={<SearchBar placeholder="Search record name…" />} />

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {[["", "Everything"], ...Object.entries(ENTITIES)].map(([k, label]) => (
          <Link key={k} href={filterHref({ entity: k, page: "" })} scroll={false} className={cn("rounded-md px-2.5 py-1 text-[12.5px] transition-colors", entity === k ? "bg-muted font-medium text-fg" : "text-muted-fg hover:text-fg")}>
            {label}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1 text-[12.5px]">
        <span className="mr-1 text-muted-fg">By</span>
        {[["", "Anyone"], ...(people ?? []).map((p: any) => [p.id, p.full_name || p.email]), ["system", "System"]].map(([k, label]) => (
          <Link key={k} href={filterHref({ actor: k, page: "" })} scroll={false} className={cn("rounded-md px-2.5 py-1 transition-colors", actor === k ? "bg-muted font-medium text-fg" : "text-muted-fg hover:text-fg")}>
            {label}
          </Link>
        ))}
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Changes</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changes = (r.changes ?? {}) as Record<string, unknown>;
                const isDiff = r.action === "updated";
                const keys = Object.keys(changes).filter((k) => !HIDE.has(k));
                const link = LINK[r.entity]?.(r.entity_id);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap">{new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{r.actor_email ?? <span className="text-muted-fg">System</span>}</td>
                    <td>
                      <span className={r.action === "deleted" ? "badge-danger" : r.action === "created" ? "badge-success" : "badge-info"}>{r.action}</span>
                    </td>
                    <td>
                      <div className="text-[11px] text-muted-fg">{ENTITIES[r.entity] ?? r.entity}</div>
                      {link && r.action !== "deleted" ? <Link href={link} className="font-medium hover:underline">{r.label ?? r.entity_id}</Link> : <span className="font-medium">{r.label ?? r.entity_id}</span>}
                    </td>
                    <td className="whitespace-normal">
                      <details>
                        <summary className="cursor-pointer text-[12px] text-fg-soft">
                          {isDiff ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? ` +${keys.length - 3}` : "") : `${keys.length} field${keys.length === 1 ? "" : "s"}`}
                        </summary>
                        <dl className="mt-2 grid max-w-xl grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                          {keys.map((k) => (
                            <div key={k} className="contents">
                              <dt className="font-mono text-[11px] text-muted-fg">{k}</dt>
                              <dd className="break-all">
                                {isDiff && Array.isArray(changes[k]) ? (
                                  <><span className="text-muted-fg line-through">{fmtVal((changes[k] as unknown[])[0])}</span> → <span className="text-fg">{fmtVal((changes[k] as unknown[])[1])}</span></>
                                ) : fmtVal(changes[k])}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5} className="!py-10 text-center text-muted-fg">Nothing recorded yet. Changes made from now on appear here.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={count ?? 0} pageSize={PAGE} searchParams={sp} label="changes" />
      </div>
    </div>
  );
}
