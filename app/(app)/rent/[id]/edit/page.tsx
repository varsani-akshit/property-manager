import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { PaymentFields } from "@/components/PaymentFields";
import { PaymentHistory } from "@/components/PaymentHistory";
import { paymentFieldsFrom, setCollectedTotal } from "@/lib/payments-server";
import { revalidateApp } from "@/lib/revalidate";

export const dynamic = "force-dynamic";

export default async function EditRentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  await requirePermission("mark_rent");
  const { id } = await params;
  const { err } = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb
    .from("rent_collections")
    .select("*, properties(name), leases(lessee_name, lessee_contact)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const row = data as any;
  const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
  const lease = Array.isArray(row.leases) ? row.leases[0] : row.leases;

  const currentAmount = Number(row.net_amount);
  const alreadyPaid = Number(row.collected_amount || 0);
  const outstanding = Math.max(0, currentAmount - alreadyPaid);

  async function update(formData: FormData) {
    "use server";
    await requirePermission("mark_rent");
    const sb = await supabaseServer();

    const newRent = Number(formData.get("rent_amount"));
    const wanted = Number(formData.get("collected_amount"));
    const back = (msg: string) => redirect(`/rent/${id}/edit?err=${encodeURIComponent(msg)}`);
    if (!Number.isFinite(newRent) || newRent < 0) back("Enter a valid rent amount.");
    if (!Number.isFinite(wanted) || wanted < 0) back("Enter a valid collected total.");
    const newCollected = Math.min(wanted, newRent);
    const fields = paymentFieldsFrom(formData);

    // Lowering the rent below what's been paid: bring the paid total down first.
    if (newRent < alreadyPaid) {
      const err = await setCollectedTotal(sb, "rent", id, newCollected, fields);
      if (err) back(err);
    }
    if (newRent !== currentAmount) {
      const status = newRent > 0 && newCollected >= newRent ? "collected" : newCollected > 0 ? "partial" : "due";
      const { error } = await sb.from("rent_collections").update({
        gross_amount: newRent, service_charge_deduction: 0, net_amount: newRent, status,
      }).eq("id", id);
      if (error) back(error.message);
    }
    if (newRent >= alreadyPaid) {
      const err = await setCollectedTotal(sb, "rent", id, newCollected, fields);
      if (err) back(err);
    }

    revalidateApp("/rent");
    redirect("/rent");
  }

  return (
    <div className="[&>*:not(:first-child)]:max-w-lg">
      <PageHeader
        crumbs={[
          { label: "Rent Collection", href: "/rent" },
          { label: lease?.lessee_name ?? "—" },
          { label: "Update row" },
        ]}
      />

      {err && <div className="notice-danger">{err}</div>}
      <form action={update} className="card space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="kpi-label">Due date</div>
            <div className="font-medium">{fmtDate(row.due_date)}</div>
          </div>
          <div>
            <div className="kpi-label">Status</div>
            <div className="font-medium capitalize">{row.status}</div>
          </div>
        </div>

        <div>
          <label className="label">Rent amount (KES)</label>
          <input
            name="rent_amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            defaultValue={currentAmount}
          />
        </div>

        <div className="space-y-1 rounded-lg border border-line-subtle bg-sunken p-3 text-[12.5px]">
          <div className="flex justify-between"><span>Already paid</span><span>{money(alreadyPaid)}</span></div>
          <div className="flex justify-between font-medium border-t border-border pt-1">
            <span>Currently outstanding</span>
            <span className={outstanding > 0 ? "text-danger" : ""}>{money(outstanding)}</span>
          </div>
        </div>

        <div>
          <label className="label">Total collected so far (KES)</label>
          <input
            name="collected_amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
            defaultValue={alreadyPaid}
          />
        </div>

        <PaymentFields />

        <div className="flex gap-2">
          <SubmitButton>Save</SubmitButton>
          <Link href="/rent" className="btn-secondary">Cancel</Link>
        </div>
      </form>
      <PaymentHistory kind="rent" id={id} />
    </div>
  );
}
