import { handleMcp } from "@/lib/mcp/handler";

// Same MCP endpoint with the key in the URL, for connectors that can't send headers
// (Claude.ai / ChatGPT custom connectors). Treat the URL as a secret.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ key: string }> };
export async function GET(req: Request, { params }: Ctx) { return handleMcp(req, (await params).key); }
export async function POST(req: Request, { params }: Ctx) { return handleMcp(req, (await params).key); }
export async function DELETE(req: Request, { params }: Ctx) { return handleMcp(req, (await params).key); }
