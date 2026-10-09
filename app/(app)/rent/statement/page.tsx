import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { LesseePicker } from "@/components/LesseePicker";
import { VariakaMark } from "@/components/Logo";
import { guardView } from "@/lib/guard";
import { buildStatement } from "@/lib/statement";
import { fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

type Search = { lessee?: string; lease?: string; from?: string; to?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function StatementPage({ searchParams }: { searchParams: Promise<Search> }) {
  await guardView("view_rent");
  const sp = await searchParams;
  const sb = await supabaseServer();

  if (!sp.lessee && !sp.lease) {
    const { data } = await sb.from("leases").select("lessee_name");
    const lessees = [...new Set((data ?? []).map((l: any) => l.lessee_name as string))].sort((a, b) => a.localeCompare(b));
    return (
      <div>
        <PageHeader crumbs={[{ label: "Rent Collection", href: "/rent" }, { label: "Statements" }]} subtitle="Pick a lessee to see their charges, payments and balance." />
        <LesseePicker lessees={lessees} base="/rent/statement" />
      </div>
    );
  }

  const from = sp.from && ISO.test(sp.from) ? sp.from : undefined;
  const to = sp.to && ISO.test(sp.to) ? sp.to : undefined;
  const st = await buildStatement(sb, sp.lease ? { leaseId: sp.lease } : { lessee: sp.lessee! }, { from, to });
  if (!st) notFound();

  const qs = new URLSearchParams({
    ...(sp.lease ? { lease: sp.lease } : { lessee: st.lessee }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();

  return (
    <div className="statement">
      <PageHeader
        crumbs={[{ label: "Rent Collection", href: "/rent" }, { label: "Statements", href: "/rent/statement" }, { label: st.lessee }]}
        subtitle={`${fmtDate(st.from)} – ${fmtDate(st.to)}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <a href={`/api/export/statement?${qs}`} className="btn-secondary h-8"><Download size={13} /> CSV</a>
            <PrintButton />
          </div>
        }
      />

      {/* Period picker */}
      <form className="mb-5 flex flex-wrap items-end gap-2 print:hidden" method="get">
        {sp.lease ? <input type="hidden" name="lease" value={sp.lease} /> : <input type="hidden" name="lessee" value={st.lessee} />}
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" className="input h-8 !py-1" defaultValue={st.from} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" className="input h-8 !py-1" defaultValue={st.to} />
        </div>
        <button className="btn-secondary h-8">Update</button>
        {(from || to) && <Link href={`/rent/statement?${sp.lease ? `lease=${sp.lease}` : `lessee=${encodeURIComponent(st.lessee)}`}`} className="btn-ghost h-8">Whole tenancy</Link>}
      </form>

      {/* Print-only letterhead */}
      <div className="mb-6 hidden items-start justify-between print:flex">
        <div className="flex items-center gap-2">
          <VariakaMark size={28} />
          <div>
            <div className="text-[15px] font-semibold tracking-[0.12em]">VARIAKA</div>
            <div className="text-[11px] text-muted-fg">Tenant statement</div>
          </div>
        </div>
        <div className="text-right text-[12px]">
          <div className="font-medium">{st.lessee}</div>
          {st.contact && <div className="text-muted-fg">{st.contact}</div>}
          <div className="text-muted-fg">{fmtDate(st.from)} – {fmtDate(st.to)}</div>
          <div className="text-muted-fg">Issued {fmtDate(new Date().toISOString().slice(0, 10))}</div>
        </div>
      </div>

      <div className="stat-row mb-6">
        <div className="kpi"><div className="kpi-label">Brought forward</div><div className="kpi-value">{money(st.opening)}</div></div>
        <div className="kpi"><div className="kpi-label">Charged</div><div className="kpi-value">{money(st.charges)}</div></div>
        <div className="kpi"><div className="kpi-label">Paid</div><div className="kpi-value text-success">{money(st.payments)}</div></div>
        <div className="kpi">
          <div className="kpi-label">Balance due</div>
          <div className={cn("kpi-value", st.closing > 0 ? "text-danger" : "text-success")}>{money(st.closing)}</div>
          {st.closing < 0 && <div className="kpi-hint">In credit</div>}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="kpi-label mb-2">{st.leases.length === 1 ? "Lease" : `${st.leases.length} leases`}</div>
          <ul className="space-y-1.5 text-[13px]">
            {st.leases.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/leases/${l.id}`} className="font-medium text-fg hover:underline print:no-underline">
                  {l.property}{l.compound ? <span className="font-normal text-muted-fg"> · {l.compound}</span> : null}
                </Link>
                <span className="text-muted-fg">
                  {fmtDate(l.start_date)} → {fmtDate(l.end_date)} · {money(l.rent)}/mo{" "}
                  {l.active ? <span className="badge-success ml-1">Active</span> : <span className="badge-muted ml-1">Ended</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="kpi-label mb-2">Deposit</div>
          <div className="space-y-1 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-fg">Charged</span><span className="tabular-nums">{money(st.deposit.charged)}</span></div>
            <div className="flex justify-between"><span className="text-muted-fg">Received</span><span className="tabular-nums">{money(st.deposit.received)}</span></div>
            <div className="flex justify-between border-t border-line-subtle pt-1 font-medium">
              <span>Shortfall</span>
              <span className={cn("tabular-nums", st.deposit.shortfall > 0 && "text-danger")}>{money(st.deposit.shortfall)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-0">
        <div className="section-head">
          <h2>Ledger</h2>
          <span className="text-[12px] text-muted-fg">{st.lines.length} entr{st.lines.length === 1 ? "y" : "ies"}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="hidden lg:table-cell print:table-cell">Property</th>
                <th className="hidden md:table-cell print:table-cell">Reference</th>
                <th className="text-right"><span className="sm:hidden">Amount</span><span className="hidden sm:inline print:inline">Charge</span></th>
                <th className="hidden text-right sm:table-cell print:table-cell">Payment</th>
                <th className="text-right hidden sm:table-cell print:table-cell">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="[&>td]:bg-sunken/60">
                <td>{fmtDate(st.from)}</td>
                <td className="font-medium">Balance brought forward<span className="font-normal text-muted-fg sm:hidden"> · {money(st.opening)}</span></td>
                <td className="hidden lg:table-cell print:table-cell" />
                <td className="hidden md:table-cell print:table-cell" />
                <td />
                <td className="hidden sm:table-cell print:table-cell" />
                <td className="hidden text-right font-medium sm:table-cell print:table-cell">{money(st.opening)}</td>
              </tr>
              {st.lines.map((l, i) => (
                <tr key={i}>
                  <td>{fmtDate(l.date)}</td>
                  <td className={l.kind === "payment" ? "text-success" : ""}>{l.description}<span className="block text-[11px] text-muted-fg sm:hidden">bal {money(l.balance)}</span></td>
                  <td className="text-muted-fg hidden lg:table-cell print:table-cell">{l.property}</td>
                  <td className="font-mono text-[11.5px] hidden md:table-cell print:table-cell">{l.reference ?? ""}</td>
                  <td className="text-right">
                    {l.charge ? money(l.charge) : ""}
                    {l.payment ? <span className="text-success sm:hidden print:hidden">−{money(l.payment)}</span> : null}
                  </td>
                  <td className="hidden text-right text-success sm:table-cell print:table-cell">{l.payment ? money(l.payment) : ""}</td>
                  <td className={cn("text-right font-medium hidden sm:table-cell print:table-cell", l.balance > 0 ? "text-fg" : "text-success")}>{money(l.balance)}</td>
                </tr>
              ))}
              {!st.lines.length && <tr><td colSpan={7} className="!py-10 text-center text-muted-fg">No charges or payments in this period.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Totals</td>
                <td className="hidden lg:table-cell print:table-cell" />
                <td className="hidden md:table-cell print:table-cell" />
                <td className="text-right">{money(st.charges)}<span className="block text-success sm:hidden">−{money(st.payments)}</span></td>
                <td className="hidden text-right sm:table-cell print:table-cell">{money(st.payments)}</td>
                <td className={cn("hidden text-right sm:table-cell print:table-cell", st.closing > 0 ? "text-danger" : "text-success")}>{money(st.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
