"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type CompoundRow = {
  id: string;
  name: string;
  address: string | null;
  property_count: number;
  valuation: number;
  sqft: number;
  collected: number;
  costs: number;
};

type SortKey = "name" | "address" | "property_count" | "valuation" | "sqft" | "collected" | "costs";
type SortDir = "asc" | "desc";

const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function CompoundsTable({ rows, pageSize = 25 }: { rows: CompoundRow[]; pageSize?: number }) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":            cmp = nat.compare(a.name, b.name); break;
        case "address":         cmp = nat.compare(a.address ?? "", b.address ?? ""); break;
        case "property_count":  cmp = a.property_count - b.property_count; break;
        case "valuation":       cmp = a.valuation - b.valuation; break;
        case "sqft":            cmp = a.sqft - b.sqft; break;
        case "collected":       cmp = a.collected - b.collected; break;
        case "costs":           cmp = a.costs - b.costs; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const view = sorted.slice(start, start + pageSize);

  function toggle(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "name" || k === "address" ? "asc" : "desc"); }
    setPage(1);
  }

  function Header({ label, k, align }: { label: string; k: SortKey; align?: "left" | "right" | "center" }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggle(k)}
        className={cn(
          "cursor-pointer select-none hover:text-primary",
          align === "right" && "text-right",
          align === "center" && "text-center"
        )}
      >
        <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
          {label}
          {active && (sortDir === "asc" ? <ChevronUp size={12}/> : <ChevronDown size={12}/>)}
        </span>
      </th>
    );
  }

  return (
    <div className="card p-0">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <Header label="Name" k="name" />
              <Header label="Address" k="address" />
              <Header label="Properties" k="property_count" align="right" />
              <Header label="Sqft" k="sqft" align="right" />
              <Header label="Valuation" k="valuation" align="right" />
              <Header label="Collected (all-time)" k="collected" align="right" />
              <Header label="Costs (all-time)" k="costs" align="right" />
            </tr>
          </thead>
          <tbody>
            {view.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/compounds/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                <td className="text-xs text-muted-fg">{c.address || "—"}</td>
                <td className="text-right">{c.property_count}</td>
                <td className="text-right">{c.sqft.toLocaleString()}</td>
                <td className="text-right">{money(c.valuation)}</td>
                <td className="text-right">{money(c.collected)}</td>
                <td className="text-right text-muted-fg">{money(c.costs)}</td>
              </tr>
            ))}
            {!view.length && <tr><td colSpan={7} className="text-center text-muted-fg py-8">No compounds.</td></tr>}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-fg">
          <span>Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}</span>
          <div className="flex gap-1">
            <button className="btn-secondary text-xs disabled:opacity-40" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
            <button className="btn-secondary text-xs disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
