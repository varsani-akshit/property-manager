import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { getAnalyticsFacts } from "@/lib/analytics/server";
import { guardView } from "@/lib/guard";
import { has } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Portfolio analytics. The page loads one compact fact set (cached until any
 * write) and the dashboard slices it in the browser, so filters, drill-downs
 * and comparisons are instant. Filters live in the URL (shareable links).
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const profile = await guardView("view_dashboard");
  const [sp, facts] = await Promise.all([searchParams, getAnalyticsFacts()]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Portfolio analytics — filter by period, compound, property, client or staff; click anything to drill in."
        actions={
          <div className="flex flex-wrap gap-2">
            {has(profile, "view_rent") && <a href="/api/export/outstanding" className="btn-secondary h-8"><Download size={13} /> Outstanding</a>}
            {has(profile, "view_rent") && <a href="/api/export/payments?range=1y" className="btn-secondary h-8"><Download size={13} /> Payments</a>}
          </div>
        }
      />
      <AnalyticsDashboard facts={facts} query={sp} links={{ rent: has(profile, "view_rent") }} />
    </div>
  );
}
