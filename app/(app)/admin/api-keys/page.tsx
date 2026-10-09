import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmButton } from "@/components/ConfirmButton";
import { getCurrentProfile } from "@/lib/permissions-server";
import { has, firstAllowedPath } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { MCP_TOOLS } from "@/lib/mcp/catalog";
import { CreateKey } from "./CreateKey";
import { revokeApiKey } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!has(profile, "manage_users")) redirect(firstAllowedPath(profile));

  const sb = await supabaseServer();
  const [{ data: keys }, { data: users }] = await Promise.all([
    sb.from("api_keys").select("id, name, prefix, user_id, created_at, last_used_at, revoked_at").order("created_at", { ascending: false }),
    sb.from("user_profiles").select("id, full_name, email").order("email"),
  ]);
  const label = new Map((users ?? []).map((u: any) => [u.id, u.full_name || u.email]));

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const mcpUrl = `${proto}://${host}/api/mcp`;

  return (
    <div>
      <PageHeader
        title="API keys & MCP"
        subtitle="Connect Claude, ChatGPT or any MCP client to Variaka to ask questions about the portfolio and record payments."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <CreateKey users={(users ?? []).map((u: any) => ({ id: u.id, label: u.full_name || u.email }))} defaultUser={profile.id} mcpUrl={mcpUrl} />

          <div className="card p-0">
            <div className="section-head">
              <h2>Keys</h2>
              <span className="text-[12px] text-muted-fg">{(keys ?? []).filter((k: any) => !k.revoked_at).length} active</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Key</th><th>Acts as</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {(keys ?? []).map((k: any) => (
                    <tr key={k.id}>
                      <td className="font-medium">{k.name}</td>
                      <td className="font-mono text-[11.5px] text-muted-fg">{k.prefix}…</td>
                      <td>{label.get(k.user_id) ?? "—"}</td>
                      <td>{fmtDate(k.created_at)}</td>
                      <td className="text-muted-fg">{k.last_used_at ? fmtDate(k.last_used_at) : "Never"}</td>
                      <td>{k.revoked_at ? <span className="badge-muted">Revoked</span> : <span className="badge-success">Active</span>}</td>
                      <td className="text-right">
                        {!k.revoked_at && (
                          <ConfirmButton
                            action={revokeApiKey}
                            hiddenInputs={{ id: k.id }}
                            confirm={`Revoke "${k.name}"? Anything using it stops working immediately.`}
                            label="Revoke"
                            className="btn-danger-ghost btn-sm"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                  {!(keys ?? []).length && <tr><td colSpan={7} className="!py-10 text-center text-muted-fg">No keys yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-0">
            <div className="section-head">
              <h2>Tools the AI can use</h2>
              <span className="text-[12px] text-muted-fg">{MCP_TOOLS.length} tools · each checks the key owner&apos;s permissions</span>
            </div>
            <ul className="divide-y divide-line-subtle">
              {MCP_TOOLS.map((t) => (
                <li key={t.name} className="flex gap-3 px-4 py-2.5 text-[12.5px]">
                  <code className="w-44 shrink-0 text-[11.5px] text-fg">{t.name}</code>
                  <span className="flex-1 text-fg-soft">{t.summary}</span>
                  {t.writes && <span className="badge-warning h-fit">writes</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3 text-[12.5px] leading-relaxed text-fg-soft">
            <h2 className="h2">Connect</h2>
            <div>
              <div className="kpi-label mb-1">Endpoint</div>
              <code className="block truncate rounded-md border border-border bg-sunken px-2.5 py-1.5 text-[12px] text-fg">{mcpUrl}</code>
            </div>
            <div>
              <div className="font-medium text-fg">Claude (claude.ai or desktop)</div>
              Settings → Connectors → <em>Add custom connector</em>. Paste the connector URL shown when you create a key (it ends in <code>/api/mcp/vk_…</code>).
            </div>
            <div>
              <div className="font-medium text-fg">ChatGPT</div>
              Settings → Apps &amp; Connectors → Advanced → Developer mode, then <em>Create</em> and paste the same connector URL. Choose &ldquo;No authentication&rdquo; — the key is in the URL.
            </div>
            <div>
              <div className="font-medium text-fg">Claude Code</div>
              <code className="mt-1 block whitespace-pre-wrap break-all rounded-md border border-border bg-sunken px-2.5 py-1.5 text-[11.5px] text-fg">{`claude mcp add --transport http variaka ${mcpUrl} --header "Authorization: Bearer vk_…"`}</code>
            </div>
            <div className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-[12px] text-warning">
              A key is as powerful as the person it belongs to. Keep connector URLs private, give each device its own key, and revoke keys you no longer use.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
