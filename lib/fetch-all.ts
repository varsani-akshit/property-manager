/**
 * Supabase returns at most 1,000 rows per request. For queries that can exceed
 * that (portfolio-wide rent rows), page through with .range() until done.
 *
 *   const rows = await fetchAll((from, to) => sb.from("x").select("…").range(from, to));
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}
