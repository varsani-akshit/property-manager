// Pure period helpers — server-safe.
// Importing client-only files from server components throws at runtime, so the
// types and resolvers live here and DateFilter (client component) imports them.

export type Range = "30d" | "3m" | "6m" | "1y" | "custom";
export type Period = { from: string; to: string; label: string; range: Range };

export const PERIOD_PRESETS: { range: Exclude<Range, "custom">; label: string; days: number }[] = [
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
  const preset = PERIOD_PRESETS.find((p) => p.range === sp.range) ?? PERIOD_PRESETS[0];
  const from = new Date();
  from.setDate(from.getDate() - preset.days);
  return { from: from.toISOString().slice(0, 10), to: isoToday, label: preset.label, range: preset.range };
}

export function periodDays(p: Period): number {
  return Math.max(1, Math.round((new Date(p.to).getTime() - new Date(p.from).getTime()) / 86400000));
}
