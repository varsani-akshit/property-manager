import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { Kpi } from "@/components/Kpi";
import { money, fmtDate, firstOfMonthISO } from "@/lib/format";
import { has } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

type RentRow = {
  id: string;
  due_month: string;
  gross_amount: number;
  service_charge_deduction: number;
  net_amount: number;
  status: string;
  collected_at: string | null;
  properties: { name: string } | { name: string }[] | null;
  leases: { lessee_name: string; lessee_contact: string | null } | { lessee_name: string; lessee_contact: string | null }[] | null;
};

function pickOne<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

async function generateThisMonth() {
  "use server";
  await requirePermission("mark_rent");
  const sb = await supabaseServer();
  await sb.rpc("generate_due_rents", { p_month: firstOfMonthISO() });
  await sb.rpc("post_monthly_service_charges", { p_month: firstOfMonthISO() });
  revalidatePath("/rent");
}

async function markCollected(formData: FormData) {
  "use server";
  await requirePermission("mark_rent");
  const id = String(formData.get("id"));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  await sb.from("rent_collections").update({
    status: "collected",
    collected_at: new Date().toISOString(),
    collected_by: user?.id,
  }).eq("id", id);
  revalidatePath("/rent");
}

export default async function RentPage() {
  const profile = await guardView("view_rent");
  const sb = await supabaseServer();
  const monthStart = firstOfMonthISO(); // first of current month

  const { data: dueRows } = await sb
    .from("rent_collections")
    .select("id, due_month, gross_amount, service_charge_deduction, net_amount, status, collected_at, properties(name), leases(lessee_name, lessee_contact)")
    .eq("status", "due")
    .order("due_month", { ascending: true });

  const { data: collectedRows } = await sb
    .from("rent_collections")
    .select("id, due_month, gross_amount, service_charge_deduction, net_amount, status, collected_at, properties(name), leases(lessee_name, lessee_contact)")
    .eq("status", "collected")
    .order("collected_at", { ascending: false })
    .limit(50);

  const due = (dueRows ?? []) as unknown as RentRow[];
  const collected = (collectedRows ?? []) as unknown as RentRow[];

  const outstanding = due.filter((r) => r.due_month < monthStart);   // past months still unpaid
  const dueSoon     = due.filter((r) => r.due_month >= monthStart);  // current + future months

  const sum = (arr: RentRow[]) => arr.reduce((s, r) => s + Number(r.net_amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Rent Collection"
        subtitle="Track due, outstanding (overdue), and collected rent"
        actions={
          has(profile, "mark_rent") ? (
            <form action={generateThisMonth}>
              <button className="btn-secondary">Generate this month</button>
            </form>
          ) : null
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="Due soon" value={money(sum(dueSoon))} hint={`${dueSoon.length} row${dueSoon.length === 1 ? "" : "s"}`} />
        <Kpi label="Outstanding (overdue)" value={money(sum(outstanding))} hint={`${outstanding.length} row${outstanding.length === 1 ? "" : "s"}`} />
        <Kpi label="Collected (recent)" value={money(sum(collected))} hint={`Last ${collected.length}`} />
      </div>

      <Section
        title={`Outstanding — overdue (${outstanding.length})`}
        emptyText="Nothing overdue. 👌"
        rows={outstanding}
        showMark={has(profile, "mark_rent")}
        markAction={markCollected}
        emphasizeStatus="overdue"
      />

      <Section
        title={`Due soon — this month and upcoming (${dueSoon.length})`}
        emptyText="Nothing due right now."
        rows={dueSoon}
        showMark={has(profile, "mark_rent")}
        markAction={markCollected}
        emphasizeStatus="due_soon"
      />

      <Section
        title={`Recently collected (${collected.length})`}
        emptyText="No collections yet."
        rows={collected}
        showMark={false}
        markAction={markCollected}
        emphasizeStatus="collected"
        showCollectedAt
      />
    </div>
  );
}

function Section({
  title, rows, emptyText, showMark, markAction, emphasizeStatus, showCollectedAt,
}: {
  title: string;
  rows: RentRow[];
  emptyText: string;
  showMark: boolean;
  markAction: (fd: FormData) => Promise<void>;
  emphasizeStatus: "due_soon" | "overdue" | "collected";
  showCollectedAt?: boolean;
}) {
  const badge =
    emphasizeStatus === "overdue" ? "badge-danger" :
    emphasizeStatus === "due_soon" ? "badge-warning" :
    "badge-success";

  return (
    <div className="card mb-6">
      <h2 className="font-semibold mb-3">{title}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>{showCollectedAt ? "Collected on" : "Due month"}</th>
            <th>Property</th>
            <th>Lessee</th>
            <th>Contact</th>
            <th className="text-right">Gross</th>
            <th className="text-right">SC deduction</th>
            <th className="text-right">Net</th>
            <th></th>
            {showMark && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = pickOne(r.properties);
            const l = pickOne(r.leases);
            return (
              <tr key={r.id}>
                <td>{showCollectedAt ? fmtDate(r.collected_at) : fmtDate(r.due_month)}</td>
                <td>{p?.name}</td>
                <td>{l?.lessee_name}</td>
                <td>{l?.lessee_contact || "—"}</td>
                <td className="text-right">{money(r.gross_amount)}</td>
                <td className="text-right text-muted-fg">{money(r.service_charge_deduction)}</td>
                <td className="text-right font-medium">{money(r.net_amount)}</td>
                <td><span className={badge}>{emphasizeStatus.replace("_", " ")}</span></td>
                {showMark && (
                  <td className="text-right">
                    <form action={markAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn-primary text-xs">Mark collected</button>
                    </form>
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={showMark ? 9 : 8} className="text-center text-muted-fg py-6">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
