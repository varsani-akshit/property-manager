/**
 * Bulk backfill (Rent Collection → Bulk backfill) was the one-off tool for
 * importing historical rents when the portfolio was migrated in. It edits past
 * rent rows wholesale, so it is switched off: the button is hidden, its pages
 * show a notice, and its save action refuses to run.
 *
 * To reopen it for a future migration, set ENABLE_BULK_BACKFILL=true in the
 * environment and redeploy.
 */
export const BULK_BACKFILL_ENABLED = process.env.ENABLE_BULK_BACKFILL === "true";
