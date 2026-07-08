import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function RaiseRentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("create_lease");
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: lease } = await sb
    .from("leases")
    .select("*, properties(name, service_charge_monthly)")
    .eq("id", id)
    .maybeSingle();
  if (!lease) notFound();

  const { data: history } = await sb
    .from("lease_rent_changes")
    .select("effective_date, old_amount, new_amount, reason, created_at")
    .eq("lease_id", id)
    .order("effective_date", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);
  const prop: any = (lease as any).properties;
  const currentRent = Number((lease as any).gross_rent_monthly);

  async function applyRaise(formData: FormData) {
    "use server";
    await requirePermission("create_lease");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const newAmount = Number(formData.get("new_amount"));
    const effectiveDateRaw = String(formData.get("effective_date"));
    const reason = String(formData.get("reason") || "").trim() || null;
    if (!Number.isFinite(newAmount) || newAmount <= 0) throw new Error("Enter a valid new rent amount");
    if (!effectiveDateRaw) throw new Error("Pick an effective date");

    // Guard: rent raises never touch historical rows. Effective date is clamped
    // to today so an accidental past date can't rewrite already-billed months.
    const todayISO = new Date().toISOString().slice(0, 10);
    const effectiveDate = effectiveDateRaw < todayISO ? todayISO : effectiveDateRaw;

    const { data: leaseRow } = await sb
      .from("leases")
      .select("gross_rent_monthly")
      .eq("id", id)
      .maybeSingle();
    if (!leaseRow) throw new Error("Lease not found");

    const oldAmount = Number((leaseRow as any).gross_rent_monthly);

    // 1) Update the lease's current rent
    const { error: e1 } = await sb.from("leases").update({ gross_rent_monthly: newAmount }).eq("id", id);
    if (e1) throw new Error(e1.message);

    // 2) Update unpaid rent rows on or after the effective date. Full-gross
    //    collection: no SC netting, net = gross.
    const { error: e2 } = await sb.from("rent_collections")
      .update({ gross_amount: newAmount, service_charge_deduction: 0, net_amount: newAmount })
      .eq("lease_id", id)
      .in("status", ["due", "partial"])
      .gte("due_date", effectiveDate);
    if (e2) throw new Error(e2.message);

    // 3) Log the change
    await sb.from("lease_rent_changes").insert({
      lease_id: id,
      effective_date: effectiveDate,
      old_amount: oldAmount,
      new_amount: newAmount,
      reason,
      changed_by: user?.id ?? null,
    });

    redirect(`/leases/${id}`);
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Raise rent"
        subtitle={`${(lease as any).lessee_name} · ${prop?.name}`}
        actions={<Link href={`/leases/${id}`} className="btn-secondary text-xs">Back to lease</Link>}
      />

      <form action={applyRaise} className="card space-y-4">
        <div>
          <div className="text-xs text-muted-fg uppercase">Current rent</div>
          <div className="font-medium">{money(currentRent)} / month</div>
        </div>

        <div>
          <label className="label">New rent (KES / month)</label>
          <input
            name="new_amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            defaultValue={currentRent}
          />
        </div>

        <div>
          <label className="label">Effective from</label>
          <input
            name="effective_date"
            type="date"
            required
            min={today}
            className="input"
            defaultValue={today}
          />
        </div>

        <div>
          <label className="label">Reason (optional)</label>
          <input
            name="reason"
            className="input"
            placeholder="e.g. annual escalation, renegotiation, etc."
          />
        </div>

        <div className="flex gap-2">
          <SubmitButton loadingText="Applying…">Apply rent change</SubmitButton>
          <Link href={`/leases/${id}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>

      {(history ?? []).length > 0 && (
        <div className="card p-0 mt-6">
          <div className="px-3 py-3 border-b border-border">
            <h2 className="font-semibold">Rent change history</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Effective from</th>
                  <th className="text-right">Old amount</th>
                  <th className="text-right">New amount</th>
                  <th className="text-right">Change</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history!.map((h: any, i: number) => {
                  const diff = Number(h.new_amount) - Number(h.old_amount);
                  return (
                    <tr key={i}>
                      <td>{fmtDate(h.effective_date)}</td>
                      <td className="text-right">{money(h.old_amount)}</td>
                      <td className="text-right font-medium">{money(h.new_amount)}</td>
                      <td className={`text-right font-medium ${diff > 0 ? "text-success" : diff < 0 ? "text-danger" : ""}`}>
                        {diff > 0 ? "+" : ""}{money(diff)}
                      </td>
                      <td className="text-muted-fg text-xs">{h.reason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
