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

export default async function CollectCostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  await requirePermission("mark_rent");
  const { id } = await params;
  const { err } = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb
    .from("costs")
    .select("*, leases(lessee_name, properties(name)), cost_line_items(category, amount)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const row = data as any;
  if (!row.payable_by_lessee) {
    // Not a lessee-payable cost — redirect to edit instead.
    redirect(`/costs/${id}/edit`);
  }

  const lease = Array.isArray(row.leases) ? row.leases[0] : row.leases;
  const property = lease?.properties
    ? (Array.isArray(lease.properties) ? lease.properties[0] : lease.properties)
    : null;

  const expected = Number(row.amount);
  const alreadyPaid = Number(row.collected_amount || 0);
  const outstanding = Math.max(0, expected - alreadyPaid);
  const lineItems: { category: string; amount: number }[] = (row.cost_line_items ?? []).map((l: any) => ({
    category: l.category, amount: Number(l.amount),
  }));

  async function update(formData: FormData) {
    "use server";
    await requirePermission("mark_rent");
    const sb = await supabaseServer();
    const wanted = Number(formData.get("collected_amount"));
    if (!Number.isFinite(wanted) || wanted < 0) redirect(`/costs/${id}/collect?err=${encodeURIComponent("Enter a valid amount.")}`);
    const err = await setCollectedTotal(sb, "cost", id, Math.min(wanted, expected), paymentFieldsFrom(formData));
    if (err) redirect(`/costs/${id}/collect?err=${encodeURIComponent(err)}`);
    revalidateApp("/rent");
    redirect("/rent");
  }

  return (
    <div className="[&>*:not(:first-child)]:max-w-lg">
      <PageHeader
        crumbs={[
          { label: "Rent Collection", href: "/rent" },
          { label: lease?.lessee_name ?? "—" },
          { label: "Collect cost charge" },
        ]}
      />

      {err && <div className="notice-danger">{err}</div>}
      <form action={update} className="card space-y-4">
        <div>
          <div className="kpi-label">Cost</div>
          <div className="font-medium">{row.description}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="kpi-label">Due date</div>
            <div className="font-medium">{fmtDate(row.due_date)}</div>
          </div>
          <div>
            <div className="kpi-label">Total billed</div>
            <div className="font-medium">{money(expected)}</div>
          </div>
        </div>

        {lineItems.length > 0 && (
          <div>
            <div className="kpi-label mb-1.5">Line items</div>
            <div className="divide-y divide-line-subtle rounded-lg border border-border">
              {lineItems.map((li, i) => (
                <div key={i} className="flex justify-between px-3 py-1.5 text-[13px]">
                  <span className="capitalize">{li.category}</span>
                  <span className="tabular-nums">{money(li.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1 rounded-lg border border-line-subtle bg-sunken p-3 text-[12.5px]">
          <div className="flex justify-between"><span>Already paid</span><span>{money(alreadyPaid)}</span></div>
          <div className="flex justify-between font-medium border-t border-border pt-1">
            <span>Currently outstanding</span>
            <span className={outstanding > 0 ? "text-danger" : ""}>{money(outstanding)}</span>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="f-collected_amount">Total collected so far (KES)</label>
          <input id="f-collected_amount"
            name="collected_amount"
            type="number"
            step="0.01"
            min="0"
            max={expected}
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
      <PaymentHistory kind="cost" id={id} />
    </div>
  );
}
