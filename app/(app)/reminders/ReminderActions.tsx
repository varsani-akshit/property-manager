"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Mail, MessageCircle, MessageSquare, Phone } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { mailLink, parseContact, smsLink, whatsappLink } from "@/lib/contact";
import { logReminder } from "./actions";

/**
 * "Remind" for one lessee: edit the pre-written message, then send it from
 * WhatsApp, SMS or email (opens on this device) — each send is logged.
 */
export function ReminderActions({
  lessee,
  leaseId,
  contact,
  kind,
  amount,
  message,
  subject,
  canSend,
}: {
  lessee: string;
  leaseId?: string | null;
  contact: string | null;
  kind: "overdue" | "expiry" | "deposit";
  amount?: number | null;
  message: string;
  subject: string;
  canSend: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(message);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const { phone, email } = parseContact(contact);

  const log = (channel: string) =>
    start(async () => {
      const res = await logReminder({ lessee, leaseId, kind, channel, amount, message: text });
      setNote(res.ok ? "Logged." : res.error ?? "Couldn't log it.");
      if (res.ok) router.refresh();
    });

  const go = (channel: string, href: string) => {
    window.open(href, "_blank", "noopener");
    log(channel);
  };

  if (!canSend) return null;
  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => { setText(message); setNote(null); setOpen(true); }}>
        Remind
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Remind ${lessee}`}>
        <div className="space-y-3">
          <div className="text-[12px] text-muted-fg">
            {contact ? <>Contact on file: <span className="text-fg">{contact}</span></> : "No contact on file — add one on the lease to message directly."}
          </div>
          <textarea className="input min-h-[140px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary" onClick={() => go("whatsapp", whatsappLink(phone, text))}>
              <MessageCircle size={14} /> WhatsApp
            </button>
            <button type="button" className="btn-secondary" disabled={!phone} onClick={() => phone && go("sms", smsLink(phone, text))}>
              <MessageSquare size={14} /> SMS
            </button>
            <button type="button" className="btn-secondary" disabled={!email} onClick={() => email && go("email", mailLink(email, subject, text))}>
              <Mail size={14} /> Email
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {copied ? "Copied" : "Copy text"}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-line-subtle pt-3 text-[12px]">
            <button type="button" className="btn-ghost btn-sm" onClick={() => log("call")}>
              <Phone size={13} /> Log a phone call instead
            </button>
            {note && <span className="text-muted-fg">{note}</span>}
          </div>
        </div>
      </Dialog>
    </>
  );
}
