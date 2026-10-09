"use client";
import { Printer } from "lucide-react";

/** Opens the browser's print dialog — "Save as PDF" there gives a clean PDF (see @media print in globals.css). */
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary h-8" onClick={() => window.print()}>
      <Printer size={13} /> {label}
    </button>
  );
}
