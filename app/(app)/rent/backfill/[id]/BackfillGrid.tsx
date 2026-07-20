"use client";
import { useMemo, useState } from "react";
import { money, fmtDate } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type BackfillRow = {
  id: string;
  due_month: string;
  due_date: string;
  net_amount: number;
  collected_amount: number;
  status: "due" | "partial" | "collected" | string;
  lessee_name: string;
  property_name: string;
};

type SortKey = "due_month" | "lessee_name" | "property_name" | "net_amount" | "collected_amount" | "status";
type SortDir = "asc" | "desc";

const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function BackfillGrid({
  rows,
  action,
  propertyLabel,
}: {
  rows: BackfillRow[];
  action: (fd: FormData) => Promise<void>;
  propertyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_month");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((r) =>
          r.lessee_name.toLowerCase().includes(q) ||
          r.property_name.toLowerCase().includes(q) ||
          r.due_month.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q))
      : rows;

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "due_month":       cmp = a.due_month.localeCompare(b.due_month); break;
        case "lessee_name":     cmp = nat.compare(a.lessee_name, b.lessee_name); break;
        case "property_name":   cmp = nat.compare(a.property_name, b.property_name); break;
        case "net_amount":      cmp = a.net_amount - b.net_amount; break;
        case "collected_amount":cmp = a.collected_amount - b.collected_amount; break;
        case "status":          cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "due_month" ? "desc" : "asc");
    }
  }

  function Header({ label, k, align }: { label: string; k: SortKey; align?: "left" | "right" | "center" }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
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
    <form action={action}>
      <div className="mb-3 flex flex-wrap gap-3 items-center">
        <div className="relative w-full sm:w-80">
          <input
            type="search"
            placeholder="Search lessee, month, status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 px-3 rounded bg-transparent border border-border text-sm placeholder:text-muted-fg focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <span className="text-xs text-muted-fg">
          {filtered.length} of {rows.length} rows
        </span>
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <Header label="Month" k="due_month" />
                <th>Due date</th>
                <Header label="Property" k="property_name" />
                <Header label="Lessee" k="lessee_name" />
                <Header label="Rent (KES)" k="net_amount" />
                <Header label="Collected (KES)" k="collected_amount" />
                <Header label="Status" k="status" align="center" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const statusBadge =
                  r.status === "collected" ? "badge-success" :
                  r.status === "partial" ? "badge-warning" :
                  "badge-muted";
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-medium">{r.due_month.slice(0, 7)}</td>
                    <td className="text-muted-fg text-xs">{fmtDate(r.due_date)}</td>
                    <td className="text-xs">{r.property_name}</td>
                    <td className="text-xs">{r.lessee_name}</td>
                    <td>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name={`orig_rent_${r.id}`} value={r.net_amount} />
                      <input
                        name={`rent_${r.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={r.net_amount}
                        className="input w-32 py-1 h-8 text-left"
                      />
                    </td>
                    <td>
                      <input type="hidden" name={`orig_coll_${r.id}`} value={r.collected_amount} />
                      <input
                        name={`coll_${r.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={r.collected_amount}
                        className="input w-32 py-1 h-8 text-left"
                      />
                    </td>
                    <td className="text-center"><span className={statusBadge}>{r.status}</span></td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={7} className="text-center text-muted-fg py-6">No rows match this search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 sticky bottom-4">
        <SubmitButton loadingText="Saving…">Save changes</SubmitButton>
        <span className="text-xs text-muted-fg">{propertyLabel}</span>
      </div>
    </form>
  );
}
