import { supabaseServer } from "@/lib/supabase/server";
import { Kpi } from "@/components/Kpi";
import { PageHeader } from "@/components/PageHeader";
import { money, fmtDate, firstOfMonthISO } from "@/lib/format";
import { guardView } from "@/lib/guard";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await guardView("view_dashboard");
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  const [propsRes, leasesRes, rentRes, costsRes, alertsRes] = await Promise.all([
    sb.from("v_property_summary").select("*"),
    sb.from("leases").select("id, end_date, active").eq("active", true),
    sb.from("rent_collections").select("status, net_amount, due_date").gte("due_date", `${new Date().getFullYear()}-01-01`),
    sb.from("cost_allocations").select("allocated_amount, costs!inner(incurred_on)").gte("costs.incurred_on", `${new Date().getFullYear()}-01-01`),
    sb.from("rent_collections")
      .select("id, due_date, net_amount, status, properties(name), leases(lessee_name)")
      .eq("status", "due")
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(10),
  ]);

  const propsArr = propsRes.data ?? [];
  const totalValuation = propsArr.reduce((s, p: any) => s + Number(p.valuation || 0), 0);
  const occupied = propsArr.filter((p: any) => p.active_lease_count > 0).length;
  const monthlyExpected = propsArr.reduce(
    (s, p: any) => s + Number(p.current_gross_rent || 0), 0
  );

  const rent = rentRes.data ?? [];
  const collectedYTD = rent.filter((r: any) => r.status === "collected").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const dueOutstanding = rent.filter((r: any) => r.status === "due").reduce((s: number, r: any) => s + Number(r.net_amount), 0);

  const costsYTD = (costsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.allocated_amount), 0);
  const netYTD = collectedYTD - costsYTD;

  const expiringSoon = (leasesRes.data ?? []).filter((l: any) => {
    const days = (new Date(l.end_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 60;
  }).length;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Portfolio overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Properties" value={String(propsArr.length)} hint={`${occupied} occupied`} />
        <Kpi label="Portfolio valuation" value={money(totalValuation)} />
        <Kpi label="Monthly expected rent" value={money(monthlyExpected)} />
        <Kpi label="Leases expiring ≤60d" value={String(expiringSoon)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Rent collected YTD" value={money(collectedYTD)} />
        <Kpi label="Outstanding rent" value={money(dueOutstanding)} />
        <Kpi label="Costs YTD" value={money(costsYTD)} />
        <Kpi label="Net YTD" value={money(netYTD)} hint={netYTD >= 0 ? "Profit" : "Loss"} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Outstanding rent</h2>
          <Link href="/rent" className="text-sm text-accent hover:underline">View all →</Link>
        </div>
        {alertsRes.data?.length ? (
          <table className="table">
            <thead>
              <tr><th>Property</th><th>Lessee</th><th>Due date</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {alertsRes.data.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.properties?.name}</td>
                  <td>{r.leases?.lessee_name}</td>
                  <td>{fmtDate(r.due_date)}</td>
                  <td className="text-right">{money(r.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-fg">All rent is collected. Nice.</p>
        )}
      </div>
    </div>
  );
}
