// What a click on a table's sortable header does to its sort (browser-safe: the table component and
// the tests share it).

/** a column's first-click direction: its own when it names one (the portal's defaultSortDirection), else numbers descending, text ascending */
export interface SortableColumn { id: string; numeric: boolean; firstSort?: "asc" | "desc" }

/** Clicking the sorted column flips its direction; clicking another sorts by it in its first-click direction. */
export function headerSort(current: { column: string; desc?: boolean } | undefined, c: SortableColumn): { column: string; desc?: true } {
  if (current && current.column === c.id) return current.desc ? { column: c.id } : { column: c.id, desc: true };
  const desc = c.firstSort ? c.firstSort === "desc" : c.numeric;
  return desc ? { column: c.id, desc: true } : { column: c.id };
}
