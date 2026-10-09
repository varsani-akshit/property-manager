"use client";
import { useMemo, useState } from "react";
import { rowLink } from "@/lib/row-link";
import Link from "next/link";
import { money, fmtDate } from "@/lib/format";
import { SortTh } from "@/components/TableBits";

export type SCTableRow = {
  id: string;
  due_month: string;
  amount: number;
  status: "pending" | "paid" | "skipped" | "lessee_direct";
  paid_at: string | null;
  property_id: string;
  property_name: string;
  compound_name: string;
};

type SortKey = "due_month" | "property_name" | "compound_name" | "amount" | "paid_at";
type SortDir = "asc" | "desc";

const MOBILE_HIDDEN = new Set<string>(["compound_name"]);
const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function SCTable({
  rows,
  tab,
  canPay,
}: {
  rows: SCTableRow[];
  tab: "pending" | "paid" | "skipped" | "lessee_direct";
  canPay: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>(tab === "paid" ? "paid_at" : "due_month");
  const [sortDir, setSortDir] = useState<SortDir>(tab === "pending" ? "asc" : "desc");
  const showCheckbox = canPay && (tab === "pending" || tab === "skipped");

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "due_month":     cmp = a.due_month.localeCompare(b.due_month); break;
        case "property_name": cmp = nat.compare(a.property_name, b.property_name); break;
        case "compound_name": cmp = nat.compare(a.compound_name, b.compound_name); break;
        case "amount":        cmp = a.amount - b.amount; break;
        case "paid_at":       cmp = (a.paid_at ?? "").localeCompare(b.paid_at ?? ""); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function toggle(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "amount" || k === "paid_at" ? "desc" : "asc"); }
  }

  function header(label: string, k: SortKey, align?: "left" | "right" | "center") {
    return <SortTh key={k} label={label} active={sortKey === k} dir={sortDir} onClick={() => toggle(k)} align={align} className={MOBILE_HIDDEN.has(k) ? "hidden sm:table-cell" : undefined} />;
  }

  return (
    <div className="table-wrap table-tight">
      <table className="table">
        <thead>
          <tr>
            {showCheckbox && (
              <th className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    e.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>("input.sc-row-check").forEach((c) => { c.checked = on; });
                  }}
                />
              </th>
            )}
            {header("Month", "due_month")}
            {header("Property", "property_name")}
            {header("Compound", "compound_name")}
            {header("Amount", "amount", "right")}
            {tab === "paid" && header("Paid on", "paid_at")}
            <th className="text-center hidden sm:table-cell">Status</th>
            {canPay && tab === "pending" && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} {...rowLink(`/properties/${r.property_id}`)}>
              {showCheckbox && (
                <td data-row-ignore><input type="checkbox" name="ids" value={r.id} className="sc-row-check" aria-label={`Select ${r.property_name} ${r.due_month.slice(0, 7)}`} /></td>
              )}
              <td className="whitespace-nowrap">{r.due_month.slice(0, 7)}</td>
              <td className="[overflow-wrap:anywhere]"><Link href={`/properties/${r.property_id}`} className="font-medium hover:underline">{r.property_name}</Link></td>
              <td className="text-muted-fg hidden sm:table-cell">{r.compound_name}</td>
              <td className="text-right">{money(r.amount)}</td>
              {tab === "paid" && <td>{fmtDate(r.paid_at)}</td>}
              <td className="text-center hidden sm:table-cell">
                {r.status === "pending" && <span className="badge-warning">pending</span>}
                {r.status === "paid" && <span className="badge-success">paid</span>}
                {r.status === "skipped" && <span className="badge-muted">skipped</span>}
                {r.status === "lessee_direct" && <span className="badge-muted">lessee direct</span>}
              </td>
              {canPay && tab === "pending" && (
                <td className="text-right" data-row-ignore>
                  <button
                    type="button"
                    onClick={(e) => {
                      // Tick only this row and submit the parent form via the bulk-pay submitter.
                      const btn = e.currentTarget as HTMLButtonElement;
                      const form = btn.closest("form");
                      if (!form) return;
                      const checks = form.querySelectorAll<HTMLInputElement>('input.sc-row-check');
                      checks.forEach((c) => { c.checked = c.value === r.id; });
                      const submitter = form.querySelector<HTMLButtonElement>('button[name="action"][value="pay"]');
                      if (submitter) form.requestSubmit(submitter);
                    }}
                    className="btn-primary btn-sm"
                  >
                    Pay
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={10} className="!py-10 text-center text-muted-fg">
                {tab === "pending" ? "Nothing pending." : "Nothing here."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
