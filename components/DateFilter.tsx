import Link from "next/link";
import { cn } from "@/lib/cn";

export type Range = "30d" | "3m" | "6m" | "1y" | "custom";

export type Period = { from: string; to: string; label: string; range: Range };

const PRESETS: { range: Exclude<Range, "custom">; label: string; days: number }[] = [
  { range: "30d", label: "Last 30 days", days: 30 },
  { range: "3m",  label: "Last 3 months", days: 90 },
  { range: "6m",  label: "Last 6 months", days: 182 },
  { range: "1y",  label: "Last 1 year", days: 365 },
];

export function resolvePeriod(sp: { range?: string; from?: string; to?: string }): Period {
  const isoToday = new Date().toISOString().slice(0, 10);
  if (sp.range === "custom" && sp.from && sp.to) {
    return { from: sp.from, to: sp.to, label: `${sp.from} → ${sp.to}`, range: "custom" };
  }
  const preset = PRESETS.find((p) => p.range === sp.range) ?? PRESETS[0];
  const from = new Date();
  from.setDate(from.getDate() - preset.days);
  return { from: from.toISOString().slice(0, 10), to: isoToday, label: preset.label, range: preset.range };
}

export function periodDays(p: Period): number {
  return Math.max(1, Math.round((new Date(p.to).getTime() - new Date(p.from).getTime()) / 86400000));
}

export function DateFilter({ active }: { active: Range }) {
  return (
    <div className="card mb-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Link
            key={p.range}
            href={`?range=${p.range}`}
            className={cn(
              "btn-secondary text-xs",
              active === p.range && "bg-primary text-primary-fg border-primary hover:bg-primary/90"
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form action="" method="get" className="flex items-center gap-2 sm:ml-auto flex-wrap">
        <input type="hidden" name="range" value="custom" />
        <label className="text-xs text-muted-fg">From</label>
        <input type="date" name="from" className="input !w-auto text-xs" required />
        <label className="text-xs text-muted-fg">To</label>
        <input type="date" name="to" className="input !w-auto text-xs" required />
        <button className={cn("btn-secondary text-xs", active === "custom" && "bg-primary text-primary-fg border-primary")}>
          Apply
        </button>
      </form>
    </div>
  );
}
