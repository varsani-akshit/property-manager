// Lessee contact fields are free text ("0722 123456 / jane@acme.co.ke"). Pull out
// a phone number and an email so reminders can open WhatsApp, SMS or mail.

export function parseContact(raw: string | null | undefined): { phone: string | null; email: string | null } {
  const s = raw ?? "";
  const email = s.match(/[^\s,;/<>]+@[^\s,;/<>]+\.[a-z]{2,}/i)?.[0] ?? null;
  const digits = s.replace(email ?? "", "").match(/\+?\d[\d\s-]{7,}\d/)?.[0]?.replace(/[^\d+]/g, "") ?? null;
  return { phone: digits ? toInternational(digits) : null, email };
}

/** Kenyan numbers: 07xx / 01xx → 2547xx / 2541xx; keeps other international numbers. */
function toInternational(n: string): string {
  const d = n.replace(/^\+/, "");
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return d;
}

export function whatsappLink(phone: string | null, text: string) {
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
export function smsLink(phone: string, text: string) {
  return `sms:+${phone}?&body=${encodeURIComponent(text)}`;
}
export function mailLink(email: string, subject: string, text: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
