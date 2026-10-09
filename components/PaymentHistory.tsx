import { supabaseServer } from "@/lib/supabase/server";
import { fmtDate, money } from "@/lib/format";
import { methodLabel, type PaymentKind } from "@/lib/payment-methods";

/** Every payment logged against one rent row, cost or deposit — newest first. */
export async function PaymentHistory({ kind, id, title = "Payment history" }: { kind: PaymentKind; id: string; title?: string }) {
  const sb = await supabaseServer();
  let q = sb.from("payments").select("id, amount, paid_on, method, reference, notes, recorded_by, created_at").order("paid_on", { ascending: false }).order("created_at", { ascending: false });
  q = kind === "rent" ? q.eq("rent_collection_id", id) : kind === "cost" ? q.eq("cost_id", id) : q.eq("kind", "deposit").eq("lease_id", id);
  const [{ data: rows }, { data: people }] = await Promise.all([q, sb.from("user_profiles").select("id, full_name, email")]);
  const who = new Map((people ?? []).map((p: any) => [p.id, p.full_name || p.email]));

  return (
    <div className="card mt-4 p-0">
      <div className="section-head">
        <h2>{title}</h2>
        <span className="text-[12px] text-muted-fg">{(rows ?? []).length} entr{(rows ?? []).length === 1 ? "y" : "ies"}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Received</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th><th>By</th></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p: any) => (
              <tr key={p.id}>
                <td>{fmtDate(p.paid_on)}</td>
                <td>{p.method === "adjustment" ? <span className="badge-warning">Adjustment</span> : methodLabel(p.method)}</td>
                <td className="font-mono text-[11.5px]">{p.reference || <span className="text-muted-fg">—</span>}</td>
                <td className={`text-right font-medium ${Number(p.amount) < 0 ? "text-danger" : ""}`}>{money(p.amount)}</td>
                <td className="text-muted-fg">{p.recorded_by ? who.get(p.recorded_by) ?? "—" : p.method === "opening" ? "Imported" : "—"}</td>
              </tr>
            ))}
            {!(rows ?? []).length && <tr><td colSpan={5} className="!py-8 text-center text-muted-fg">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
