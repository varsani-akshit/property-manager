import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { guardView } from "@/lib/guard";
import { has } from "@/lib/permissions";
import { outstandingByLessee } from "@/lib/outstanding";
import { fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ReminderActions } from "./ReminderActions";

export const dynamic = "force-dynamic";

type Tab = "overdue" | "expiring" | "deposit" | "log";
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ tab?: string; lessee?: string }> }) {
  const profile = await guardView("view_rent");
  const sp = await searchParams;
  const tab: Tab = (["overdue", "expiring", "deposit", "log"] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : "overdue";
  const focus = sp.lessee?.trim() || null;
  const canSend = has(profile, "mark_rent");

  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [owed, expiringRes, logRes, people] = await Promise.all([
    outstandingByLessee(sb, today),
    sb.from("leases").select("id, lessee_name, lessee_contact, end_date, gross_rent_monthly, properties(name)").eq("active", true).gte("end_date", today).lte("end_date", in60).order("end_date"),
    sb.from("reminders").select("id, lessee_name, kind, channel, amount, message, sent_by, sent_at").order("sent_at", { ascending: false }).limit(200),
    sb.from("user_profiles").select("id, full_name, email"),
  ]);
  const who = new Map((people.data ?? []).map((p: any) => [p.id, p.full_name || p.email]));
  const reminders = (logRes.data ?? []) as any[];
  const lastBy = new Map<string, any>();
  for (const r of reminders) if (!lastBy.has(r.lessee_name)) lastBy.set(r.lessee_name, r);

  const overdue = owed.filter((o) => o.rent + o.costs > 0);
  const deposits = owed.filter((o) => o.deposit > 0);
  const expiring = (expiringRes.data ?? []) as any[];
  const show = <T extends { lessee?: string; lessee_name?: string }>(rows: T[]) =>
    focus ? rows.filter((r) => (r.lessee ?? r.lessee_name ?? "").toLowerCase() === focus.toLowerCase()) : rows;

  const totalOverdue = overdue.reduce((s, o) => s + o.rent + o.costs, 0);
  const remindedThisWeek = reminders.filter((r) => Date.now() - new Date(r.sent_at).getTime() < 7 * 86400000).length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "overdue", label: "Overdue", count: overdue.length },
    { key: "expiring", label: "Leases ending", count: expiring.length },
    { key: "deposit", label: "Deposit shortfall", count: deposits.length },
    { key: "log", label: "Sent", count: reminders.length },
  ];
  const href = (t: Tab) => `/reminders?tab=${t}${focus ? `&lessee=${encodeURIComponent(focus)}` : ""}`;

  const last = (name: string) => {
    const r = lastBy.get(name);
    if (!r) return <span className="text-muted-fg">Never</span>;
    const days = Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86400000);
    return <span title={`${r.channel} · ${who.get(r.sent_by) ?? ""}`}>{days === 0 ? "Today" : `${days}d ago`} <span className="text-muted-fg">· {r.channel}</span></span>;
  };

  return (
    <div>
      <PageHeader title="Reminders" subtitle="Who to chase today, with the message ready to send. Every reminder sent is logged." />

      <div className="stat-row mb-6">
        <Kpi label="Overdue" value={money(totalOverdue)} tone={totalOverdue > 0 ? "danger" : undefined} hint={`${overdue.length} lessee${overdue.length === 1 ? "" : "s"}`} />
        <Kpi label="30+ days late" value={String(overdue.filter((o) => o.daysOverdue > 30).length)} hint="Lessees" />
        <Kpi label="Leases ending ≤ 60d" value={String(expiring.length)} />
        <Kpi label="Reminders this week" value={String(remindedThisWeek)} />
      </div>

      {focus && (
        <div className="notice-info items-center justify-between">
          <span>Showing <span className="font-medium text-fg">{focus}</span> only.</span>
          <Link href={`/reminders?tab=${tab}`} className="btn-secondary btn-sm">Show everyone</Link>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            scroll={false}
            role="tab"
            aria-selected={tab === t.key}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors", tab === t.key ? "bg-muted font-medium text-fg" : "text-muted-fg hover:text-fg")}
          >
            {t.label}
            <span className="text-[11.5px] tabular-nums text-muted-fg">{t.count}</span>
          </Link>
        ))}
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          {tab === "overdue" && (
            <table className="table">
              <thead>
                <tr><th>Lessee</th><th>Contact</th><th className="text-right">Rent</th><th className="text-right">Charges</th><th className="text-right">Total</th><th className="text-right">Oldest</th><th>Last reminded</th><th></th></tr>
              </thead>
              <tbody>
                {show(overdue).map((o) => {
                  const amt = o.rent + o.costs;
                  const msg = `Hello ${o.lessee}, this is a reminder that Ksh ${amt.toLocaleString("en-KE")} is overdue for ${o.properties.join(", ")}${o.oldestDue ? ` (oldest amount due ${fmtDate(o.oldestDue)})` : ""}. Kindly arrange payment at your earliest convenience and share the payment reference. Thank you.`;
                  return (
                    <tr key={o.lessee}>
                      <td>
                        <Link href={`/rent/statement?lessee=${encodeURIComponent(o.lessee)}`} className="font-medium hover:underline">{o.lessee}</Link>
                        <div className="mt-0.5 max-w-[18rem] truncate text-[12px] text-muted-fg">{o.properties.join(", ")}</div>
                      </td>
                      <td className="text-muted-fg">{o.contact || "—"}</td>
                      <td className="text-right">{money(o.rent)}</td>
                      <td className="text-right">{money(o.costs)}</td>
                      <td className="text-right font-medium text-danger">{money(amt)}</td>
                      <td className={cn("text-right", o.daysOverdue > 30 ? "font-medium text-danger" : "text-warning")}>{o.daysOverdue}d</td>
                      <td>{last(o.lessee)}</td>
                      <td className="text-right">
                        <ReminderActions lessee={o.lessee} leaseId={o.leaseIds[0]} contact={o.contact} kind="overdue" amount={amt} message={msg} subject="Rent reminder" canSend={canSend} />
                      </td>
                    </tr>
                  );
                })}
                {!show(overdue).length && <tr><td colSpan={8} className="!py-10 text-center text-muted-fg">Nobody is overdue.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "expiring" && (
            <table className="table">
              <thead>
                <tr><th>Lessee</th><th>Property</th><th>Contact</th><th>Ends</th><th className="text-right">Days left</th><th className="text-right">Rent / mo</th><th>Last reminded</th><th></th></tr>
              </thead>
              <tbody>
                {show(expiring).map((l) => {
                  const days = Math.round((new Date(l.end_date + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
                  const prop = one<any>(l.properties)?.name ?? "the property";
                  const msg = `Hello ${l.lessee_name}, your lease for ${prop} ends on ${fmtDate(l.end_date)}. Please let us know whether you would like to renew so we can prepare the paperwork. Thank you.`;
                  return (
                    <tr key={l.id}>
                      <td><Link href={`/leases/${l.id}`} className="font-medium hover:underline">{l.lessee_name}</Link></td>
                      <td>{prop}</td>
                      <td className="text-muted-fg">{l.lessee_contact || "—"}</td>
                      <td>{fmtDate(l.end_date)}</td>
                      <td className={cn("text-right font-medium", days <= 14 ? "text-danger" : days <= 30 ? "text-warning" : "")}>{days}</td>
                      <td className="text-right">{money(l.gross_rent_monthly)}</td>
                      <td>{last(l.lessee_name)}</td>
                      <td className="text-right">
                        <ReminderActions lessee={l.lessee_name} leaseId={l.id} contact={l.lessee_contact} kind="expiry" message={msg} subject="Your lease renewal" canSend={canSend} />
                      </td>
                    </tr>
                  );
                })}
                {!show(expiring).length && <tr><td colSpan={8} className="!py-10 text-center text-muted-fg">No leases end in the next 60 days.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "deposit" && (
            <table className="table">
              <thead>
                <tr><th>Lessee</th><th>Property</th><th>Contact</th><th className="text-right">Shortfall</th><th>Last reminded</th><th></th></tr>
              </thead>
              <tbody>
                {show(deposits).map((o) => {
                  const msg = `Hello ${o.lessee}, our records show a deposit balance of Ksh ${o.deposit.toLocaleString("en-KE")} outstanding for ${o.properties.join(", ")}. Kindly arrange payment and share the reference. Thank you.`;
                  return (
                    <tr key={o.lessee}>
                      <td><Link href={`/rent/statement?lessee=${encodeURIComponent(o.lessee)}`} className="font-medium hover:underline">{o.lessee}</Link></td>
                      <td className="max-w-[18rem] truncate">{o.properties.join(", ")}</td>
                      <td className="text-muted-fg">{o.contact || "—"}</td>
                      <td className="text-right font-medium text-danger">{money(o.deposit)}</td>
                      <td>{last(o.lessee)}</td>
                      <td className="text-right">
                        <ReminderActions lessee={o.lessee} leaseId={o.leaseIds[0]} contact={o.contact} kind="deposit" amount={o.deposit} message={msg} subject="Deposit balance" canSend={canSend} />
                      </td>
                    </tr>
                  );
                })}
                {!show(deposits).length && <tr><td colSpan={6} className="!py-10 text-center text-muted-fg">All deposits are fully paid.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "log" && (
            <table className="table">
              <thead>
                <tr><th>Sent</th><th>Lessee</th><th>About</th><th>Channel</th><th className="text-right">Amount</th><th>By</th><th>Message</th></tr>
              </thead>
              <tbody>
                {show(reminders).map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.sent_at)}</td>
                    <td className="font-medium">{r.lessee_name}</td>
                    <td className="capitalize">{r.kind}</td>
                    <td className="capitalize">{r.channel}</td>
                    <td className="text-right">{r.amount != null ? money(r.amount) : "—"}</td>
                    <td className="text-muted-fg">{who.get(r.sent_by) ?? "—"}</td>
                    <td className="max-w-[24rem] truncate text-muted-fg" title={r.message}>{r.message}</td>
                  </tr>
                ))}
                {!show(reminders).length && <tr><td colSpan={7} className="!py-10 text-center text-muted-fg">No reminders sent yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
