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

  const expected = Number(row.net_amount);
  const alreadyPaid = Number(row.collected_amount || 0);
  const outstanding = Math.max(0, expected - alreadyPaid);

  async function update(formData: FormData) {
    "use server";
    await requirePermission("mark_rent");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const newCollectedRaw = Number(formData.get("collected_amount"));
    if (!Number.isFinite(newCollectedRaw) || newCollectedRaw < 0) throw new Error("Invalid amount");
    // Clamp to net_amount — can't collect more than expected
    const newCollected = Math.min(newCollectedRaw, expected);

    let status = "due";
    let collected_at: string | null = row.collected_at ?? null;
    if (newCollected >= expected) {
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
      collected_amount: newCollected,
      status,
      collected_at,
      collected_by: newCollected > 0 ? user?.id ?? null : null,
    }).eq("id", id);

    redirect("/rent");
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="Update rent collection" subtitle={`${lease?.lessee_name ?? "—"} — ${property?.name ?? ""}`} />

      <form action={update} className="card space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-fg">Due date</div>
            <div className="font-medium">{fmtDate(row.due_date)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg">Gross</div>
            <div className="font-medium">{money(row.gross_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg">SC deduction</div>
            <div className="font-medium">{money(row.service_charge_deduction)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg">Net expected</div>
            <div className="font-medium">{money(expected)}</div>
          </div>
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
            max={expected}
            required
            className="input"
            defaultValue={alreadyPaid}
          />
          <p className="text-xs text-muted-fg mt-1">
            Enter the cumulative amount collected. Status auto-updates:
            0 → due · &gt;0 and &lt; net → partial · = net → collected.
          </p>
        </div>

        <div className="flex gap-2">
          <SubmitButton>Save</SubmitButton>
          <Link href="/rent" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
