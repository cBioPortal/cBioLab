// What choosing a table's shown columns does to its query (browser-safe: the table component and the tests share it).
import type { ColumnFilter } from "./table-query.ts";

/**
 * The query patch for showing `next` (undefined: the table's defaults) where `shown` are shown now. A column the
 * choice hides loses its header filter, as the portal's Columns menu clears it on toggling the column off (MUT-TB-5,
 * LazyMobXTable); the other filters, the search and the sort stay.
 */
export function columnsPatch(q: { filters?: Record<string, ColumnFilter> }, next: string[] | undefined, shown: readonly string[], defaults: readonly string[]):
  { columns: string[] | undefined; filters?: Record<string, ColumnFilter> } {
  const after = new Set(next ?? defaults);
  const hidden = shown.filter((id) => !after.has(id) && q.filters && id in q.filters);
  if (!hidden.length) return { columns: next };
  const filters = { ...q.filters };
  for (const id of hidden) delete filters[id];
  return { columns: next, filters };
}
