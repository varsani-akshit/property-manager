"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/** Type-ahead list of lessees; picking one navigates to `${base}?lessee=…`. */
export function LesseePicker({ lessees, base }: { lessees: string[]; base: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const list = q.trim() ? lessees.filter((l) => l.toLowerCase().includes(q.trim().toLowerCase())) : lessees;
  return (
    <div className="card max-w-xl p-0">
      <div className="section-head">
        <div className="relative w-full">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
          <input className="input h-8 !pl-8" placeholder="Find a lessee…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
      </div>
      <ul className="max-h-[60vh] divide-y divide-line-subtle overflow-y-auto">
        {list.map((l) => (
          <li key={l}>
            <button type="button" className="w-full px-4 py-2.5 text-left text-[13px] text-fg hover:bg-muted/60" onClick={() => router.push(`${base}?lessee=${encodeURIComponent(l)}`)}>
              {l}
            </button>
          </li>
        ))}
        {!list.length && <li className="px-4 py-8 text-center text-[13px] text-muted-fg">No lessees match.</li>}
      </ul>
    </div>
  );
}
