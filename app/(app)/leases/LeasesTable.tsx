"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money, fmtDate } from "@/lib/format";
import { SortTh, TablePager } from "@/components/TableBits";

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

const MOBILE_HIDDEN = new Set<string>(["start_date", "end_date", "active"]);
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
  const start = (page - 1) * pageSize;
  const view = sorted.slice(start, start + pageSize);

  function toggle(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "start_date" || k === "gross_rent_monthly" ? "desc" : "asc"); }
    setPage(1);
  }

  function header(label: string, k: SortKey, align?: "left" | "right" | "center") {
    return <SortTh key={k} label={label} active={sortKey === k} dir={sortDir} onClick={() => toggle(k)} align={align} className={MOBILE_HIDDEN.has(k) ? "hidden sm:table-cell" : undefined} />;
  }

  return (
    <div className="card p-0">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {header("Property", "property_name")}
              {header("Lessee", "lessee_name")}
              <th className="hidden md:table-cell">Contact</th>
              {header("Start", "start_date")}
              {header("End", "end_date")}
              {header("Rent", "gross_rent_monthly", "right")}
              {header("Status", "active", "center")}
            </tr>
          </thead>
          <tbody>
            {view.map((l) => {
              const href = `/leases/${l.id}`;
              return (
                <tr key={l.id} className="cursor-pointer">
                  <td>
                    <Link href={href} className="block font-medium">{l.property_name}</Link>
                    <Link href={href} className="block text-xs text-muted-fg">{l.compound_name}<span className="sm:hidden"> · until {fmtDate(l.end_date)}{l.active ? "" : " (ended)"}</span></Link>
                  </td>
                  <td><Link href={href} className="block font-medium">{l.lessee_name}</Link></td>
                  <td className="hidden md:table-cell"><Link href={href} className="block">{l.lessee_contact || "—"}</Link></td>
                  <td className="hidden sm:table-cell"><Link href={href} className="block">{fmtDate(l.start_date)}</Link></td>
                  <td className="hidden sm:table-cell"><Link href={href} className="block">{fmtDate(l.end_date)}</Link></td>
                  <td className="text-right"><Link href={href} className="block">{money(l.gross_rent_monthly)}</Link></td>
                  <td className="text-center hidden sm:table-cell">
                    <Link href={href} className="block">
                      {l.active ? <span className="badge-success">Active</span> : <span className="badge-muted">Ended</span>}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!view.length && <tr><td colSpan={7} className="!py-10 text-center text-muted-fg">No leases match.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  );
}
