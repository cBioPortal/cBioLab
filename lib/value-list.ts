// Explore's value lists as the portal's study-view tables behave (STS-TBL-2, -3, -5): which rows a
// search shows and in what order, and what Select all / Deselect all change. No React, so the page
// and the tests read the same rules.

/**
 * a row as the rules read it: its key, the value shown, its count, its share as written, whether
 * the filter already holds it, and `solo` for a row that cannot join others in one filter (NA)
 */
export interface ListRow { key: string; name: string; n: number; share?: string; on?: boolean; disabled?: boolean; solo?: boolean }

/** a list scrolls past this many rows; from there it gets its search box, as the portal's tables do */
export const LIST_SEARCH_FROM = 10;

/**
 * Whether a row matches the search (STS-TBL-3): the value by case-insensitive substring, the count
 * with or without its thousands separators ("1,084" and "1084"), or the share as written.
 */
export function listRowMatches(r: ListRow, search: string): boolean {
  const q = search.trim().toUpperCase();
  if (!q) return true;
  const digits = q.replace(/,/g, "");
  return r.name.toUpperCase().includes(q) || (digits !== "" && String(r.n).includes(digits)) || (r.share ?? "").toUpperCase().includes(q);
}

/** the rows shown: those the search matches, the ones the filter holds pinned first (STS-TBL-2), each group in the list's own order */
export function listRows<T extends ListRow>(rows: T[], search: string): T[] {
  const shown = rows.filter((r) => listRowMatches(r, search));
  return [...shown.filter((r) => r.on), ...shown.filter((r) => !r.on)];
}

/**
 * Select all / Deselect all over the rows shown (STS-TBL-5): Select all adds every shown row that
 * can be checked and can join the others (not NA) to the checked ones, keeping the earlier ones;
 * Deselect all takes the shown rows out. Each is null when it would change nothing, as the portal
 * hides it then.
 */
export function listBulk(shown: ListRow[], picked: string[]): { selectAll: string[] | null; deselectAll: string[] | null } {
  const checkable = shown.filter((r) => !r.on && !r.disabled && !r.solo).map((r) => r.key);
  const adds = checkable.filter((k) => !picked.includes(k));
  const shownKeys = new Set(shown.map((r) => r.key));
  const kept = picked.filter((k) => !shownKeys.has(k));
  return {
    selectAll: adds.length ? [...picked, ...adds] : null,
    deselectAll: kept.length < picked.length ? kept : null,
  };
}
