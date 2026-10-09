import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "./PageHeader";

/** Shown in place of the bulk backfill pages while the tool is switched off (lib/features.ts). */
export function BackfillLocked() {
  return (
    <div>
      <PageHeader crumbs={[{ label: "Rent Collection", href: "/rent" }, { label: "Bulk backfill" }]} />
      <div className="mx-auto mt-10 flex max-w-md flex-col items-center text-center">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-fg">
          <Lock size={18} />
        </span>
        <h2 className="text-[15px] font-semibold text-fg">Bulk backfill is switched off</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">
          This was the one-time tool for importing historical rents during the migration. It&apos;s now closed so past
          rent rows can&apos;t be overwritten by mistake. Record payments from Rent Collection, or open a lease to fill in
          any missing months.
        </p>
        <Link href="/rent" className="btn-primary mt-5">Go to Rent Collection</Link>
      </div>
    </div>
  );
}
