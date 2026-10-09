import { handleMcp } from "@/lib/mcp/handler";

// MCP endpoint (Streamable HTTP). Auth: `Authorization: Bearer vk_…`. See /admin/api-keys.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = (req: Request) => handleMcp(req);
export { handler as GET, handler as POST, handler as DELETE };
