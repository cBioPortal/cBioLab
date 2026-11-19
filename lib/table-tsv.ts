// The portal's table download (LazyMobXTable's Download TSV, the Mutations table's: MUT-TB-8): every row
// in the table's current sort, whatever its search and filters, every column headed by its name,
// tab-separated, CRLF line ends, saved as table.tsv. Browser-safe.

/** the file name the portal gives it */
export const TABLE_TSV_NAME = "table.tsv";

/** a cell as one TSV field: missing is empty; a tab or line break inside a value becomes a space, so a value stays one field */
export function tsvField(x: unknown): string {
  return x == null ? "" : String(x).replace(/[\t\r\n]+/g, " ");
}

export const tsvLine = (xs: unknown[]): string => xs.map(tsvField).join("\t") + "\r\n";

/** the view as the download reads it: its sort kept, its search and column filters dropped (the portal downloads every row) */
export function everyRowQuery<V extends { search?: string; filters?: Record<string, unknown> }>(view: V): V {
  const out = { ...view };
  delete out.search; delete out.filters;
  return out;
}

/** the line /api/table ends a download cut short with (it answers 200, having streamed what it could) */
export const INCOMPLETE_MARK = "# DOWNLOAD INCOMPLETE";

/** why a fetched table text is not the whole table — its cut-short line's reason — or null when it is whole */
export function cutShort(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(INCOMPLETE_MARK));
  return line === undefined ? null : line.slice(INCOMPLETE_MARK.length).replace(/^[:\s]+/, "").trim() || "the table was cut short";
}

/**
 * What the copied text depends on, as one string: the table's query (its sort among it), its columns and every
 * study's row counts. Two answers with the same key copy the same text, so a fetched copy outlives a re-render
 * or a page turn, and is dropped when the query, the columns or the rows change.
 */
export function copyTableKey(t: { query: unknown; columns: { id: string }[]; lists: { cohort: string; study: string; total: number; all: number }[]; total: number; all: number }): string {
  return JSON.stringify([t.query, t.columns.map((c) => c.id), t.lists.map((l) => [l.cohort, l.study, l.total, l.all]), t.total, t.all]);
}
