"use client";
import { useRef, useState } from "react";
import { ExternalLink, Upload, X } from "lucide-react";

/**
 * Tri-purpose document field:
 *   1) Shows existing URL with "Open" link + "Remove" button
 *   2) Uploads a chosen file to Google Drive (via /api/upload), then stores the link
 *   3) Falls back to manual URL paste if the user prefers
 *
 * The actual form value is held in a hidden input with the given `name`, so this
 * drops straight into existing server-action forms.
 */
export function DriveUpload({
  name,
  kind,
  slug,
  initialUrl,
  label,
}: {
  name: string;          // hidden input name (e.g. "deed_url")
  kind: "deed" | "lease-doc";
  slug?: string;         // prefixed to uploaded filename
  initialUrl?: string | null;
  label?: string;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    if (slug) fd.set("slug", slug);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUrl(data.url);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <input type="hidden" name={name} value={url} />

      {url ? (
        <div className="flex items-center gap-2 p-2 border border-border rounded-md text-sm bg-muted/30">
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline flex-1 truncate">
            <ExternalLink size={14} /> <span className="truncate">{url}</span>
          </a>
          <button type="button" onClick={() => setUrl("")} className="p-1 rounded hover:bg-muted" aria-label="Remove">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <label className="btn-secondary text-xs flex-1 cursor-pointer">
              <Upload size={14} />
              <span>{uploading ? "Uploading…" : "Upload to Google Drive"}</span>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-xs text-muted-fg underline hover:text-fg whitespace-nowrap"
            >
              {showManual ? "Hide manual link" : "Paste link instead"}
            </button>
          </div>
          {showManual && (
            <input
              type="url"
              placeholder="https://drive.google.com/..."
              className="input text-xs"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </div>
      )}

      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}
