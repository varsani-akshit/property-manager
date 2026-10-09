"use client";
import { useState, useTransition } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Loader } from "@/components/Loader";
import { getSetupLink } from "./actions";

/** "Get link" for a pending user: makes a fresh one-time link and copies it. */
export function SetupLink({ email }: { email: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const copy = async (u: string) => {
    try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field is selectable */ }
  };

  if (url) {
    return (
      <div className="w-full space-y-1.5">
        <div className="flex gap-2">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input h-8 min-w-0 flex-1 font-mono text-[11.5px]" aria-label="Setup link" />
          <button type="button" className="btn-secondary h-8 shrink-0" onClick={() => copy(url)}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[11.5px] text-muted-fg">Works once. Earlier emailed links for {email} no longer work.</p>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await getSetupLink(email);
          if (r.url) { setUrl(r.url); copy(r.url); } else setError(r.error ?? "Couldn't create a link");
        })}
      >
        {pending ? <Loader size="xs" tone="current" /> : <Link2 size={13} />} Copy link
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </>
  );
}
