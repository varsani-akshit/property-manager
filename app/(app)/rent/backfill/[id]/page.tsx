import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/permissions-server";
import { guardView } from "@/lib/guard";
import { money, fmtDate } from "@/lib/format";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export default async function PropertyBackfillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await guardView("view_rent");
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();

  const { data: prop } = await sb
    .from("properties")
    .select("id, name, compounds(name)")
    .eq("id", id)
    .maybeSingle();
  if (!prop) notFound();

  // All rent rows for this property, all statuses. Newest month first.
  const { data: rentsData } = await sb
    .from("rent_collections")
    .select("id, due_date, due_month, gross_amount, net_amount, collected_amount, status, collected_at, lease_id, leases(lessee_name)")
    .eq("property_id", id)
    .order("due_month", { ascending: false });

  const rents = (rentsData ?? []) as any[];

  // Neighbor properties for quick nav
  const compoundId = (prop as any).compounds
    ? undefined
    : undefined; // (kept simple — we'll use compound_id fetched below)
  const { data: neighbors } = await sb
    .from("properties")
    .select("id, name, compound_id, compounds(name)")
    .eq("archived", false);
  const thisProp = (neighbors ?? []).find((p: any) => p.id === id) as any;
  const siblings = ((neighbors ?? []) as any[])
    .filter((p) => p.compound_id === thisProp?.compound_id)
    .sort((a, b) => nat.compare(a.name, b.name));
  const idx = siblings.findIndex((p) => p.id === id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const propAny: any = prop;
  const compoundName = Array.isArray(propAny.compounds) ? propAny.compounds[0]?.name : propAny.compounds?.name;

  async function saveBulk(formData: FormData) {
    "use server";
    await requirePermission("mark_rent");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();

    // Collect rows from the form. Only touch rows the user actually changed
    // (client sends every row; we detect changes vs the hidden originals).
    const ids = formData.getAll("id") as string[];
    let updated = 0;
    const errors: string[] = [];

    for (const rentId of ids) {
      const newRent = Number(formData.get(`rent_${rentId}`) ?? NaN);
      const newColl = Number(formData.get(`coll_${rentId}`) ?? NaN);
      const origRent = Number(formData.get(`orig_rent_${rentId}`) ?? NaN);
      const origColl = Number(formData.get(`orig_coll_${rentId}`) ?? NaN);

      if (!Number.isFinite(newRent) || !Number.isFinite(newColl)) continue;
      if (newRent < 0 || newColl < 0) continue;
      const changed = newRent !== origRent || newColl !== origColl;
      if (!changed) continue;

      // Clamp collected to rent, derive status
      const collClamped = Math.min(newColl, newRent);
      let status: "due" | "partial" | "collected" = "due";
      let collected_at: string | null = null;
      if (newRent > 0 && collClamped >= newRent) {
        status = "collected";
        collected_at = new Date().toISOString();
      } else if (collClamped > 0) {
        status = "partial";
        collected_at = new Date().toISOString();
      }

      const { error } = await sb.from("rent_collections").update({
        gross_amount: newRent,
        service_charge_deduction: 0,
        net_amount: newRent,
        collected_amount: collClamped,
        status,
        collected_at,
        collected_by: collClamped > 0 ? user?.id ?? null : null,
      }).eq("id", rentId);
      if (error) errors.push(`row ${rentId.slice(0, 8)}: ${error.message}`);
      else updated += 1;
    }

    revalidatePath(`/rent/backfill/${id}`);
    revalidatePath("/rent");
    const params = new URLSearchParams();
    if (updated > 0) params.set("msg", `Saved ${updated} row${updated === 1 ? "" : "s"}`);
    if (errors.length) params.set("err", errors.slice(0, 3).join(" · "));
    redirect(`/rent/backfill/${id}?${params.toString()}`);
  }

  return (
    <div>
      <PageHeader
        title={`Backfill: ${propAny.name}`}
        subtitle={compoundName}
        actions={
          <div className="flex gap-2 items-center">
            {prev && (
              <Link href={`/rent/backfill/${prev.id}`} className="btn-secondary text-xs">← {prev.name}</Link>
            )}
            {next && (
              <Link href={`/rent/backfill/${next.id}`} className="btn-secondary text-xs">{next.name} →</Link>
            )}
            <Link href="/rent/backfill" className="btn-secondary text-xs">All properties</Link>
          </div>
        }
      />

      {sp.msg && (
        <div className="card mb-4 border-success/30 bg-success/5">
          <p className="text-sm text-success">{sp.msg}</p>
        </div>
      )}
      {sp.err && (
        <div className="card mb-4 border-danger/30 bg-danger/5">
          <p className="text-sm text-danger">{sp.err}</p>
        </div>
      )}

      {rents.length === 0 ? (
        <div className="card text-sm">
          <p>No rent rows exist yet for this property.</p>
          <p className="text-xs text-muted-fg mt-2">
            Open the lease and click <em>Backfill rents</em> — that pre-creates one row per month from the lease start.
            Then come back here to edit amounts.
          </p>
        </div>
      ) : (
        <form action={saveBulk}>
          <div className="card p-0">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Due date</th>
                    <th>Lessee</th>
                    <th className="text-right">Rent (KES)</th>
                    <th className="text-right">Collected (KES)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rents.map((r: any) => {
                    const lease = Array.isArray(r.leases) ? r.leases[0] : r.leases;
                    const rent = Number(r.net_amount ?? 0);
                    const coll = Number(r.collected_amount ?? 0);
                    const statusBadge =
                      r.status === "collected" ? "badge-success" :
                      r.status === "partial" ? "badge-warning" :
                      "badge-muted";
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap font-medium">{String(r.due_month).slice(0, 7)}</td>
                        <td className="text-muted-fg text-xs">{fmtDate(r.due_date)}</td>
                        <td className="text-xs">{lease?.lessee_name ?? "—"}</td>
                        <td className="text-right">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name={`orig_rent_${r.id}`} value={rent} />
                          <input
                            name={`rent_${r.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={rent}
                            className="input text-right w-32 py-1 h-8"
                          />
                        </td>
                        <td className="text-right">
                          <input type="hidden" name={`orig_coll_${r.id}`} value={coll} />
                          <input
                            name={`coll_${r.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={coll}
                            className="input text-right w-32 py-1 h-8"
                          />
                        </td>
                        <td><span className={statusBadge}>{r.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 sticky bottom-4">
            <SubmitButton loadingText="Saving…">Save all changes</SubmitButton>
            <span className="text-xs text-muted-fg">
              {rents.length} row{rents.length === 1 ? "" : "s"} · only edited rows are written
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
