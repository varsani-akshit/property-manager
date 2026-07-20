"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money, fmtDate } from "@/lib/format";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type LeaseRow = {
  id: string;
  active: boolean;
  lessee_name: string;
  lessee_contact: string | null;
  start_date: string;
  end_date: string;
  gross_rent_monthly: number;
  property_name: string;
  compound_name: string;
};

type SortKey = "property_name" | "lessee_name" | "start_date" | "end_date" | "gross_rent_monthly" | "active";
type SortDir = "asc" | "desc";

const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function LeasesTable({ rows, pageSize = 25 }: { rows: LeaseRow[]; pageSize?: number }) {
  const [sortKey, setSortKey] = useState<SortKey>("property_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "property_name":       cmp = nat.compare(a.compound_name, b.compound_name) || nat.compare(a.property_name, b.property_name); break;
        case "lessee_name":         cmp = nat.compare(a.lessee_name, b.lessee_name); break;
        case "start_date":          cmp = a.start_date.localeCompare(b.start_date); break;
        case "end_date":            cmp = a.end_date.localeCompare(b.end_date); break;
        case "gross_rent_monthly":  cmp = a.gross_rent_monthly - b.gross_rent_monthly; break;
        case "active":              cmp = (b.active ? 1 : 0) - (a.active ? 1 : 0); break;
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
    else { setSortKey(k); setSortDir(k === "start_date" || k === "gross_rent_monthly" ? "desc" : "asc"); }
    setPage(1);
  }

  function Header({ label, k, align }: { label: string; k: SortKey; align?: "left" | "right" }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggle(k)}
        className={cn("cursor-pointer select-none hover:text-primary", align === "right" && "text-right")}
      >
        <span className="inline-flex items-center gap-1">
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
              <Header label="Property" k="property_name" />
              <Header label="Lessee" k="lessee_name" />
              <th>Contact</th>
              <Header label="Start" k="start_date" />
              <Header label="End" k="end_date" />
              <Header label="Rent" k="gross_rent_monthly" align="right" />
              <Header label="Status" k="active" />
            </tr>
          </thead>
          <tbody>
            {view.map((l) => {
              const href = `/leases/${l.id}`;
              return (
                <tr key={l.id} className="cursor-pointer">
                  <td>
                    <Link href={href} className="block font-medium">{l.property_name}</Link>
                    <Link href={href} className="block text-xs text-muted-fg">{l.compound_name}</Link>
                  </td>
                  <td><Link href={href} className="block font-medium">{l.lessee_name}</Link></td>
                  <td><Link href={href} className="block">{l.lessee_contact || "—"}</Link></td>
                  <td><Link href={href} className="block">{fmtDate(l.start_date)}</Link></td>
                  <td><Link href={href} className="block">{fmtDate(l.end_date)}</Link></td>
                  <td className="text-right"><Link href={href} className="block">{money(l.gross_rent_monthly)}</Link></td>
                  <td>
                    <Link href={href} className="block">
                      {l.active ? <span className="badge-success">Active</span> : <span className="badge-muted">Ended</span>}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!view.length && <tr><td colSpan={7} className="text-center text-muted-fg py-8">No leases match.</td></tr>}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-fg">
          <span>Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}</span>
          <div className="flex gap-1">
            <button
              className="btn-secondary text-xs disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              className="btn-secondary text-xs disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
