import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { supabaseServer } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function CollectCostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("mark_rent");
  const { id } = await params;
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
    const { data: { user } } = await sb.auth.getUser();
    const newCollectedRaw = Number(formData.get("collected_amount"));
    if (!Number.isFinite(newCollectedRaw) || newCollectedRaw < 0) throw new Error("Invalid amount");
    const newCollected = Math.min(newCollectedRaw, expected);

    let status: "due" | "partial" | "collected" = "due";
    let collected_at: string | null = row.collected_at ?? null;
    if (newCollected >= expected) {
      status = "collected";
      collected_at = collected_at ?? new Date().toISOString();
    } else if (newCollected > 0) {
      status = "partial";
      collected_at = collected_at ?? new Date().toISOString();
    } else {
      collected_at = null;
    }

    await sb.from("costs").update({
      collected_amount: newCollected,
      collection_status: status,
      collected_at,
      collected_by: newCollected > 0 ? user?.id ?? null : null,
    }).eq("id", id);

    redirect("/rent");
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="Collect cost charge" subtitle={`${lease?.lessee_name ?? "—"} — ${property?.name ?? ""}`} />

      <form action={update} className="card space-y-4">
        <div>
          <div className="text-xs text-muted-fg">Cost</div>
          <div className="font-medium">{row.description}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-fg">Due date</div>
            <div className="font-medium">{fmtDate(row.due_date)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-fg">Total billed</div>
            <div className="font-medium">{money(expected)}</div>
          </div>
        </div>

        {lineItems.length > 0 && (
          <div>
            <div className="text-xs text-muted-fg mb-1">Line items</div>
            <div className="rounded border border-border divide-y">
              {lineItems.map((li, i) => (
                <div key={i} className="flex justify-between px-3 py-1.5 text-sm">
                  <span className="capitalize">{li.category}</span>
                  <span className="tabular-nums">{money(li.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
            Enter the cumulative amount collected. 0 → due · &gt;0 and &lt; total → partial · = total → collected.
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
