import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function EditRentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("mark_rent");
  const { id } = await params;
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
    const { data: { user } } = await sb.auth.getUser();

    const newRentAmount = Number(formData.get("rent_amount"));
    if (!Number.isFinite(newRentAmount) || newRentAmount < 0) throw new Error("Invalid rent amount");

    const newCollectedRaw = Number(formData.get("collected_amount"));
    if (!Number.isFinite(newCollectedRaw) || newCollectedRaw < 0) throw new Error("Invalid collected amount");
    const newCollected = Math.min(newCollectedRaw, newRentAmount);

    let status: "due" | "partial" | "collected" = "due";
    let collected_at: string | null = row.collected_at ?? null;
    if (newRentAmount > 0 && newCollected >= newRentAmount) {
      status = "collected";
      collected_at = collected_at ?? new Date().toISOString();
    } else if (newCollected > 0) {
      status = "partial";
      collected_at = collected_at ?? new Date().toISOString();
    } else {
      status = "due";
      collected_at = null;
    }

    await sb.from("rent_collections").update({
      gross_amount: newRentAmount,
      service_charge_deduction: 0,
      net_amount: newRentAmount,
      collected_amount: newCollected,
      status,
      collected_at,
      collected_by: newCollected > 0 ? user?.id ?? null : null,
    }).eq("id", id);

    redirect("/rent");
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        crumbs={[
          { label: "Rent Collection", href: "/rent" },
          { label: lease?.lessee_name ?? "—" },
          { label: "Update row" },
        ]}
      />

      <form action={update} className="card space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-fg">Due date</div>
            <div className="font-medium">{fmtDate(row.due_date)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg">Status</div>
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

        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
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

        <div className="flex gap-2">
          <SubmitButton>Save</SubmitButton>
          <Link href="/rent" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
