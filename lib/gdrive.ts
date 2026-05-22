// Server-only Google Drive integration via service account.
// Setup (one-time, in Google Cloud Console):
//   1) Create / select a project
//   2) Enable "Google Drive API"
//   3) IAM & Admin → Service Accounts → Create service account
//   4) Keys → Add key → JSON. Download the JSON file.
//   5) Copy the service account email (looks like xxx@yyy.iam.gserviceaccount.com)
//   6) In your Google Drive, create a folder, right-click → Share → paste the
//      service account email with "Editor" access.
//   7) Open the folder URL to grab the folder ID (the part after /folders/).
//   8) Set env vars on Vercel + .env.local:
//        GOOGLE_SERVICE_ACCOUNT_JSON='{...the entire JSON file contents...}'
//        GOOGLE_DRIVE_PARENT_FOLDER_ID='<the folder id>'

import "server-only";
import { google } from "googleapis";
import { Readable } from "node:stream";

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Sometimes the JSON is base64-encoded on Vercel to avoid newline issues
    try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); }
    catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"); }
  }
}

function driveClient() {
  const credentials = getCredentials();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

export type UploadedFile = {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string | null;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Uploads a Buffer to the configured Drive folder, sets anyone-with-link to
 * "reader", and returns the file's webViewLink (the same kind of URL you'd
 * paste manually).
 *
 * subfolder lets you organize uploads into subfolders (e.g. "deeds",
 * "lease-docs") under the parent folder. The subfolder is created if missing.
 */
export async function uploadToDrive(opts: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  subfolder?: string;
}): Promise<UploadedFile> {
  const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!parentId) throw new Error("GOOGLE_DRIVE_PARENT_FOLDER_ID is not set");

  const drive = driveClient();
  const targetParent = opts.subfolder
    ? await ensureSubfolder(drive, parentId, opts.subfolder)
    : parentId;

  const created = await drive.files.create({
    requestBody: {
      name: opts.filename,
      parents: [targetParent],
      mimeType: opts.mimeType,
    },
    media: {
      mimeType: opts.mimeType,
      body: Readable.from(opts.buffer),
    },
    fields: "id, name, webViewLink, webContentLink, mimeType, size",
    supportsAllDrives: true,
  });

  // Make link-shareable (anyone with the link can view).
  await drive.permissions.create({
    fileId: created.data.id!,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  return {
    id: created.data.id!,
    name: created.data.name ?? opts.filename,
    webViewLink: created.data.webViewLink ?? `https://drive.google.com/file/d/${created.data.id}/view`,
    webContentLink: created.data.webContentLink ?? null,
    mimeType: created.data.mimeType ?? opts.mimeType,
    sizeBytes: Number(created.data.size ?? opts.buffer.length),
  };
}

async function ensureSubfolder(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  name: string
): Promise<string> {
  const list = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (list.data.files && list.data.files.length > 0) return list.data.files[0].id!;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id!;
}
