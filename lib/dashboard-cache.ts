import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "./supabase/admin";
import { DATA_TAG } from "./revalidate";

/**
 * The dashboard snapshot (supabase/023) for a period, cached across requests.
 * Every signed-in user sees the same portfolio (RLS is "any signed-in user"),
 * and the page itself is gated by view_dashboard, so one shared entry per period
 * is safe. Any write calls revalidateApp(), which drops it; otherwise it
 * refreshes after two minutes (to pick up the nightly rent job).
 */
export const getDashboardSnapshot = unstable_cache(
  async (from: string, to: string) => {
    const { data, error } = await supabaseAdmin().rpc("dashboard_snapshot", { p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  },
  ["dashboard-snapshot-v1"],
  { revalidate: 120, tags: [DATA_TAG] }
);
