// Builds Variaka's Supabase auth emails from one layout.
//
//   node scripts/email-templates.mjs            → writes supabase/email-templates/*.html
//   SUPABASE_ACCESS_TOKEN=… node scripts/email-templates.mjs --apply
//                                              → also pushes subjects + bodies to the project
//
// Every link points at /auth/confirm on the Site URL with the token hash, so
// the token is spent only when the person presses Continue there (mail
// scanners that open links can't use it up). Site URL must be the app's
// public address (Supabase → Authentication → URL Configuration).
import { mkdirSync, writeFileSync } from "node:fs";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#16162b", SOFT = "#5d5d76", MUTED = "#8b8ba3", BRAND = "#5b5bd6", LINE = "#e5e5ef", BG = "#f3f3f8";
const link = (type) => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`;

function layout({ title, heading, body, button, href, note }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${heading}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
<tr><td align="center" style="padding:40px 16px 48px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="{{ .SiteURL }}/brand/variaka-email.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
        <td style="vertical-align:middle;padding-left:10px;font:500 12.5px/1 ${FONT};letter-spacing:0.18em;color:${INK};padding-right:10px;">VARIAKA</td>
        <td style="vertical-align:middle;padding-left:10px;font:400 12.5px/1 ${FONT};color:${MUTED};border-left:1px solid ${LINE};">Properties</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-top:3px solid ${BRAND};border-radius:14px;padding:34px 32px 30px;">
      <h1 style="margin:0 0 10px;font:500 22px/1.3 ${FONT};letter-spacing:-0.02em;color:${INK};">${heading}</h1>
      <p style="margin:0 0 26px;font:400 14px/1.65 ${FONT};color:${SOFT};">${body}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-radius:8px;background:${BRAND};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font:500 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${button}</a>
        </td>
      </tr></table>
      <p style="margin:22px 0 0;font:400 12.5px/1.6 ${FONT};color:${MUTED};">${note}</p>
      <div style="margin:24px 0 0;border-top:1px solid ${LINE};padding-top:16px;font:400 11.5px/1.6 ${FONT};color:${MUTED};">
        Button not working? Copy this link into your browser:<br>
        <a href="${href}" style="color:${BRAND};word-break:break-all;text-decoration:none;">${href}</a>
      </div>
    </td></tr>
    <tr><td style="padding:18px 6px 0;font:400 11.5px/1.6 ${FONT};color:${MUTED};">
      Sent to {{ .Email }} by Variaka, the internal property workspace. If you weren't expecting it, you can ignore this email.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

const ONCE = "The link works once and expires in 24 hours.";

export const TEMPLATES = {
  invite: {
    subject: "You've been invited to Variaka",
    html: layout({
      title: "Invitation to Variaka",
      heading: "You're invited to Variaka",
      body: "You've been given access to Variaka, the team's property workspace. Accept the invite to choose your password and sign in.",
      button: "Accept invite",
      href: link("invite"),
      note: ONCE,
    }),
  },
  recovery: {
    subject: "Reset your Variaka password",
    html: layout({
      title: "Reset your password",
      heading: "Reset your password",
      body: "Someone asked to reset the password for this Variaka account. Continue to choose a new one.",
      button: "Choose a new password",
      href: link("recovery"),
      note: `${ONCE} If you didn't ask for this, your password stays the same.`,
    }),
  },
  magic_link: {
    subject: "Your Variaka sign-in link",
    html: layout({
      title: "Sign in to Variaka",
      heading: "Sign in to Variaka",
      body: "Use the button below to sign in.",
      button: "Sign in",
      href: link("magiclink"),
      note: ONCE,
    }),
  },
  confirmation: {
    subject: "Confirm your email for Variaka",
    html: layout({
      title: "Confirm your email",
      heading: "Confirm your email",
      body: "Confirm this address to finish setting up your Variaka account.",
      button: "Confirm email",
      href: link("email"),
      note: ONCE,
    }),
  },
  email_change: {
    subject: "Confirm your new email for Variaka",
    html: layout({
      title: "Confirm email change",
      heading: "Confirm your new email",
      body: "Confirm that your Variaka account should use <strong style=\"color:" + INK + ";font-weight:500;\">{{ .NewEmail }}</strong> from now on.",
      button: "Confirm new email",
      href: link("email_change"),
      note: ONCE,
    }),
  },
};

mkdirSync("supabase/email-templates", { recursive: true });
for (const [name, t] of Object.entries(TEMPLATES)) {
  writeFileSync(`supabase/email-templates/${name}.html`, t.html);
}
writeFileSync(
  "supabase/email-templates/subjects.json",
  JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.subject])), null, 2) + "\n"
);
console.log("wrote supabase/email-templates/");

if (process.argv.includes("--apply")) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
  if (!token || !ref) throw new Error("Set SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL");
  const body = { mailer_otp_exp: 86400 };
  for (const [k, t] of Object.entries(TEMPLATES)) {
    body[`mailer_subjects_${k}`] = t.subject;
    body[`mailer_templates_${k}_content`] = t.html;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(res.status, res.ok ? "applied" : await res.text());
}
