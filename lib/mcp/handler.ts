import "server-only";
import { createMcpHandler } from "mcp-handler";
import { has } from "@/lib/permissions";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAs } from "@/lib/supabase/admin";
import { TOOLS } from "./tools";

const INSTRUCTIONS = `Variaka is a property-management system for a Kenyan commercial portfolio (godowns, offices, showrooms) grouped into compounds.
Money is in Kenyan shillings (KES). Rent is billed monthly per lease; lessees can also be billed charges (water, electricity…). Deposits are held separately.
Start with portfolio_summary or outstanding for overview questions; use search to find ids; lessee_statement for a tenant's ledger.
Before calling a tool that writes (record_payment, collect_in_full, log_reminder), show the user exactly what will be recorded and get a clear yes.
Get the ids for payments from unpaid_items. Never invent ids or amounts.`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * Serve one MCP request. The key comes from `Authorization: Bearer vk_…` or,
 * for clients that can't send headers (custom connectors), the URL path.
 * Only the tools the key owner is allowed to use are registered.
 */
export async function handleMcp(req: Request, pathKey?: string) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const auth = await verifyApiKey(bearer ?? pathKey);
  if (!auth) {
    return json(401, { error: "invalid_token", message: "Missing, unknown or revoked Variaka API key. Create one under Admin → API keys & MCP." });
  }
  const { profile } = auth;
  const sb = supabaseAs(profile.id);

  const handler = createMcpHandler(
    (server) => {
      for (const t of TOOLS) {
        if (!has(profile, t.perm)) continue;
        server.registerTool(
          t.name,
          {
            title: t.title,
            description: t.description,
            inputSchema: t.input,
            annotations: { readOnlyHint: !t.writes, destructiveHint: false, idempotentHint: !t.writes, openWorldHint: false },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async (args: any) => {
            try {
              const result = await t.run(args, { profile, sb });
              const isError = Boolean(result && typeof result === "object" && "error" in result);
              return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError };
            } catch (e) {
              return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
            }
          }
        );
      }
    },
    {
      serverInfo: { name: "variaka", version: "1.0.0" },
      instructions: `${INSTRUCTIONS}\nYou are acting as ${profile.full_name || profile.email}.`,
    }
  );
  return handler(req);
}
