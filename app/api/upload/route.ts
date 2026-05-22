import { NextResponse, type NextRequest } from "next/server";
import { uploadToDrive } from "@/lib/gdrive";
import { requirePermission } from "@/lib/permissions-server";
import type { ActionPermission } from "@/lib/permissions";

// Map of upload kinds → (folder name, permission required to upload).
const KIND_CONFIG: Record<string, { folder: string; perm: ActionPermission }> = {
  deed: { folder: "deeds", perm: "create_property" },
  "lease-doc": { folder: "lease-docs", perm: "create_lease" },
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const kind = String(form.get("kind") || "");
    const cfg = KIND_CONFIG[kind];
    if (!cfg) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

    await requirePermission(cfg.perm);

    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

    // Cap at 25MB to keep server memory sane
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 25MB)" }, { status: 413 });
    }

    const slug = String(form.get("slug") || "").trim().replace(/[^\w.-]+/g, "_").slice(0, 80);
    const safeName = (slug ? `${slug}-` : "") + sanitizeFilename(file.name);

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadToDrive({
      filename: safeName,
      mimeType: file.type || "application/octet-stream",
      buffer,
      subfolder: cfg.folder,
    });

    return NextResponse.json({ url: uploaded.webViewLink, name: uploaded.name });
  } catch (e: any) {
    console.error("upload failed:", e);
    return NextResponse.json({ error: e.message ?? "upload failed" }, { status: 500 });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}
