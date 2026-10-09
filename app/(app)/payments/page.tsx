import Link from "next/link";
import { rowLink } from "@/lib/row-link";
import { Download } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { DateFilter } from "@/components/DateFilter";
import { SearchBar } from "@/components/SearchBar";
import { Kpi } from "@/components/Kpi";
import { Pagination, parsePage } from "@/components/Pagination";
import { guardView } from "@/lib/guard";
import { has } from "@/lib/permissions";
import { resolvePeriod, type Range } from "@/lib/period";
import { fmtDate, money } from "@/lib/format";
import { methodLabel, PAYMENT_METHODS } from "@/lib/payment-methods";
import { fetchAll } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

const PAGE = 50;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso?: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

type Search = { range?: string; from?: string; to?: string; q?: string; method?: string; kind?: string; page?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const profile = await guardView("view_rent");
  const canLease = has(profile, "view_leases");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const page = parsePage(sp.page);
  const q = sp.q?.trim() ?? "";
  const method = sp.method && [...PAYMENT_METHODS.map((m) => m.value), "adjustment", "opening"].includes(sp.method) ? sp.method : "";
  const kind = sp.kind && ["rent", "cost", "deposit"].includes(sp.kind) ? sp.kind : "";

  const sb = await supabaseServer();

  // Search: lessee name or property → lease ids; also matches the reference text.
  let leaseIds: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [{ data: byLessee }, { data: byProp }] = await Promise.all([
      sb.from("leases").select("id").ilike("lessee_name", like),
      sb.from("leases").select("id, properties!inner(name)").ilike("properties.name", like),
    ]);
    leaseIds = [...new Set([...(byLessee ?? []), ...(byProp ?? [])].map((l: any) => l.id as string))];
  }

  const filtered = (cols: string, opts?: { count?: "exact" }) => {
    let qb = sb.from("payments").select(cols, opts).gte("paid_on", period.from).lte("paid_on", period.to);
    if (method) qb = qb.eq("method", method);
    if (kind) qb = qb.eq("kind", kind);
    if (q) {
      const ids = leaseIds?.length ? `lease_id.in.(${leaseIds.join(",")}),` : "";
      qb = qb.or(`${ids}reference.ilike.%${q.replace(/[,()]/g, " ")}%`);
    }
    return qb;
  };

  const [pageRes, allForTotals, { data: people }] = await Promise.all([
    filtered(
      "id, kind, amount, paid_on, method, reference, notes, recorded_by, lease_id, leases(id, lessee_name), properties(id, name), rent_collections(due_month), costs(description)",
      { count: "exact" }
    )
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1),
    fetchAll<any>((f, t) => filtered("amount, method, kind").range(f, t)),
    sb.from("people").select("id, full_name, email"),
  ]);
  const rows = (pageRes.data ?? []) as any[];
  const total = pageRes.count ?? 0;
  const who = new Map((people ?? []).map((p: any) => [p.id, p.full_name || p.email]));

  const received = allForTotals.reduce((s, p) => s + Number(p.amount || 0), 0);
  const byMethod = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const p of allForTotals) {
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount || 0));
    byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + Number(p.amount || 0));
  }
  const topMethod = [...byMethod.entries()].filter(([m]) => m !== "opening" && m !== "adjustment").sort((a, b) => b[1] - a[1])[0];

  const exportQs = new URLSearchParams({ range: period.range, ...(period.range === "custom" ? { from: period.from, to: period.to } : {}), ...(q ? { q } : {}), ...(method ? { method } : {}), ...(kind ? { kind } : {}) }).toString();
  const filterHref = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ range: sp.range ?? "", from: sp.from ?? "", to: sp.to ?? "", q, method, kind, ...patch })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle={`Every payment received · ${period.label}`}
        right={<DateFilter active={period.range as Range} />}
        actions={<a href={`/api/export/payments?${exportQs}`} className="btn-secondary h-8"><Download size={13} /> Export CSV</a>}
      />

      <div className="stat-row mb-6">
        <Kpi label="Received" value={money(received)} hint={`${allForTotals.length.toLocaleString()} payment${allForTotals.length === 1 ? "" : "s"}`} />
        <Kpi label="Rent" value={money(byKind.get("rent") ?? 0)} />
        <Kpi label="Lessee charges" value={money(byKind.get("cost") ?? 0)} />
        <Kpi label="Deposits" value={money(byKind.get("deposit") ?? 0)} />
        <Kpi label="Top method" value={topMethod ? methodLabel(topMethod[0]) : "—"} hint={topMethod ? money(topMethod[1]) : undefined} />
      </div>

      <div className="card p-0">
        <div className="section-head flex-wrap">
          <div className="flex flex-wrap items-center gap-1">
            {[["", "All"], ["rent", "Rent"], ["cost", "Charges"], ["deposit", "Deposits"]].map(([k, label]) => (
              <Link
                key={k}
                href={filterHref({ kind: k, page: "" })}
                scroll={false}
                className={`rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${kind === k ? "bg-muted font-medium text-fg" : "text-muted-fg hover:text-fg"}`}
              >
                {label}
              </Link>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {[["", "Any method"], ...PAYMENT_METHODS.map((m) => [m.value, m.label]), ["adjustment", "Adjustments"]].map(([m, label]) => (
              <Link
                key={m}
                href={filterHref({ method: m, page: "" })}
                scroll={false}
                className={`rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${method === m ? "bg-muted font-medium text-fg" : "text-muted-fg hover:text-fg"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          <SearchBar placeholder="Lessee, property or reference…" />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Lessee</th>
                <th className="hidden md:table-cell">Property</th>
                <th className="hidden sm:table-cell">For</th>
                <th className="hidden sm:table-cell">Method</th>
                <th className="hidden lg:table-cell">Reference</th>
                <th className="text-right">Amount</th>
                <th className="hidden xl:table-cell">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const lease = one<any>(p.leases);
                const prop = one<any>(p.properties);
                const forWhat =
                  p.kind === "rent" ? `Rent · ${monthName(one<any>(p.rent_collections)?.due_month)}`
                  : p.kind === "cost" ? one<any>(p.costs)?.description ?? "Charge"
                  : "Deposit";
                return (
                  <tr key={p.id} {...rowLink(lease ? (canLease ? `/leases/${lease.id}` : `/rent/statement?lessee=${encodeURIComponent(lease.lessee_name)}`) : undefined)}>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>
                      <div className="max-w-[8.5rem] truncate sm:max-w-[14rem]">
                        {lease ? (
                          <Link href={`/rent/statement?lessee=${encodeURIComponent(lease.lessee_name)}`} className="font-medium hover:underline" title={lease.lessee_name}>{lease.lessee_name}</Link>
                        ) : "—"}
                      </div>
                    </td>
                    <td className="hidden md:table-cell"><div className="max-w-[11rem] truncate">{prop ? <Link href={`/properties/${prop.id}`} className="hover:underline" title={prop.name}>{prop.name}</Link> : "—"}</div></td>
                    <td className="hidden sm:table-cell"><div className="max-w-[12rem] truncate" title={forWhat}>{forWhat}</div></td>
                    <td className="hidden sm:table-cell">
                      {p.method === "adjustment" ? <span className="badge-warning">Adjustment</span>
                        : p.method === "opening" ? <span className="badge-muted">Before log</span>
                        : methodLabel(p.method)}
                    </td>
                    <td className="hidden font-mono text-[11.5px] lg:table-cell">{p.reference || <span className="text-muted-fg">—</span>}</td>
                    <td className={`text-right font-medium ${Number(p.amount) < 0 ? "text-danger" : ""}`}>{money(p.amount)}</td>
                    <td className="hidden text-muted-fg xl:table-cell">{p.recorded_by ? who.get(p.recorded_by) ?? "—" : p.method === "opening" ? "Imported" : "—"}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={8} className="!py-10 text-center text-muted-fg">No payments match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} pageSize={PAGE} searchParams={sp} label="payments" />
      </div>
    </div>
  );
}
