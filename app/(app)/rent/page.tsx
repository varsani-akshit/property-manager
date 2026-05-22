import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { money, fmtDate, firstOfMonthISO } from "@/lib/format";
import { getCurrentProfile, has, requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

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
  const sb = await supabaseServer();
  const profile = await getCurrentProfile();

  const { data: due } = await sb
    .from("rent_collections")
    .select("id, due_month, gross_amount, service_charge_deduction, net_amount, status, properties(name), leases(lessee_name, lessee_contact)")
    .eq("status", "due")
    .order("due_month", { ascending: true });

  const { data: recent } = await sb
    .from("rent_collections")
    .select("id, due_month, net_amount, collected_at, properties(name), leases(lessee_name)")
    .eq("status", "collected")
    .order("collected_at", { ascending: false })
    .limit(20);

  return (
    <div>
      <PageHeader
        title="Rent Collection"
        subtitle="Mark rent as collected as it comes in"
        actions={
          has(profile, "mark_rent") ? (
            <form action={generateThisMonth}>
              <button className="btn-secondary">Generate this month</button>
            </form>
          ) : null
        }
      />

      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Outstanding ({due?.length ?? 0})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Due month</th><th>Property</th><th>Lessee</th><th>Contact</th>
              <th className="text-right">Gross</th><th className="text-right">SC deduction</th><th className="text-right">Net</th>
              {has(profile, "mark_rent") && <th></th>}
            </tr>
          </thead>
          <tbody>
            {due?.map((r: any) => (
              <tr key={r.id}>
                <td>{fmtDate(r.due_month)}</td>
                <td>{r.properties?.name}</td>
                <td>{r.leases?.lessee_name}</td>
                <td>{r.leases?.lessee_contact}</td>
                <td className="text-right">{money(r.gross_amount)}</td>
                <td className="text-right text-muted-fg">{money(r.service_charge_deduction)}</td>
                <td className="text-right font-medium">{money(r.net_amount)}</td>
                {has(profile, "mark_rent") && (
                  <td className="text-right">
                    <form action={markCollected}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn-primary text-xs">Mark collected</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {!due?.length && <tr><td colSpan={8} className="text-center text-muted-fg py-8">All caught up.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Recently collected</h2>
        <table className="table">
          <thead>
            <tr><th>Collected on</th><th>Property</th><th>Lessee</th><th>Due month</th><th className="text-right">Net</th></tr>
          </thead>
          <tbody>
            {recent?.map((r: any) => (
              <tr key={r.id}>
                <td>{fmtDate(r.collected_at)}</td>
                <td>{r.properties?.name}</td>
                <td>{r.leases?.lessee_name}</td>
                <td>{fmtDate(r.due_month)}</td>
                <td className="text-right">{money(r.net_amount)}</td>
              </tr>
            ))}
            {!recent?.length && <tr><td colSpan={5} className="text-center text-muted-fg py-8">No collections yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
