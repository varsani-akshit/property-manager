import Link from "next/link";
import { cn } from "@/lib/cn";

const TONE = { success: "text-success", warning: "text-warning", danger: "text-danger" } as const;

/** A figure with its label; no box. Put several in a `<div className="stat-row">`. */
export function Kpi({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  href?: string;
  tone?: "success" | "warning" | "danger";
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={cn("kpi-value", tone && TONE[tone])}>{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </>
  );
  return href ? <Link href={href} className="kpi">{body}</Link> : <div className="kpi">{body}</div>;
}
