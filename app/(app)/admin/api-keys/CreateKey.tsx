"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound } from "lucide-react";
import { Loader } from "@/components/Loader";
import { createApiKey } from "./actions";

export function CreateKey({ users, defaultUser, mcpUrl }: { users: { id: string; label: string }[]; defaultUser: string; mcpUrl: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState(defaultUser);
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async (v: string, what: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="card">
      <h2 className="h2">Create a key</h2>
      <p className="mb-3 mt-0.5 text-[12.5px] text-muted-fg">A key acts as the user it belongs to, with exactly their permissions. It is shown once.</p>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await createApiKey({ userId, name });
            if (res.error) setError(res.error);
            else { setKey(res.key!); setName(""); router.refresh(); }
          });
        }}
      >
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="User">
          {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        <input className="input" placeholder="Name, e.g. Claude — laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Key name" />
        <button className="btn-primary" disabled={pending}>
          {pending ? <Loader size="xs" tone="current" /> : <KeyRound size={14} />} Create key
        </button>
      </form>
      {error && <div className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}

      {key && (
        <div className="mt-4 space-y-3 rounded-lg border border-primary/30 bg-primary-soft p-3">
          <div className="text-[12.5px] font-medium text-fg">Copy this key now — it won&apos;t be shown again.</div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px]">{key}</code>
            <button type="button" className="btn-secondary" onClick={() => copy(key, "key")}>
              {copied === "key" ? <Check size={14} className="text-success" /> : <Copy size={14} />} Copy
            </button>
          </div>
          <div className="text-[12px] text-fg-soft">Connector URL with the key built in (for Claude.ai / ChatGPT custom connectors):</div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px]">{`${mcpUrl}/${key}`}</code>
            <button type="button" className="btn-secondary" onClick={() => copy(`${mcpUrl}/${key}`, "url")}>
              {copied === "url" ? <Check size={14} className="text-success" /> : <Copy size={14} />} Copy
            </button>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setKey(null)}>Done</button>
        </div>
      )}
    </div>
  );
}
