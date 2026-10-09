import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";

/** Tag on cached read models (the dashboard snapshot) that any write makes stale. */
export const DATA_TAG = "portfolio-data";

/**
 * Call after any write: refreshes the given path (like revalidatePath) and drops
 * the cached dashboard snapshot so the numbers update immediately.
 */
export function revalidateApp(path?: string, type?: "page" | "layout") {
  revalidateTag(DATA_TAG);
  if (path) revalidatePath(path, type);
}
