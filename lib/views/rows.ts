// What the table views share: their rows run in the database through lib/table-query.ts, paged
// across the participants that hold them.
import { isPatientLevel, type PatientLevelCapable } from "../federation.ts";
import type { TablePart } from "../mutation-table.ts";
import { cleanQuery, describeQuery, mergeValues, type ColumnValues, type RowSource, type TableQuery } from "../table-query.ts";
import type { ViewRun } from "./run.ts";
import { plural } from "./shared.ts";

export const TABLE_ROWS_MAX = 1000;
/** rows one page request may take (the download's chunk) */
export const TABLE_CHUNK = 10000;

/** Who may hand over rows: patient-level participants; the rest are named with their patients. */
export function rowHolders(ctx: ViewRun) {
  const holders = ctx.vStudies.filter((st) => isPatientLevel(ctx.resolvers[st]));
  const excluded = ctx.vStudies.filter((st) => !holders.includes(st)).map((st) => ({
    study: st, reason: ctx.resolvers[st].instance.id === "peer" ? "a remote peer, which does not disclose patients" : "aggregate-only: it does not disclose patients",
    patients: ctx.vNames.reduce((n, c) => n + (ctx.cohorts[c].perStudy[st]?.count || 0), 0) }));
  return { holders, excluded };
}

/** The column ids a query reads besides what is shown: its filters, its sort, and — for search — the shown ones. */
function queryReads(q: TableQuery, shown: string[]): string[] {
  return [...new Set([...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : []), ...((q.search || "").trim() ? shown : [])])];
}

export type Rows = { rows: Record<string, unknown>[]; lists: { cohort: string; study: string; total: number; all: number }[]; total: number; all: number; offset: number; groups: number; values?: ColumnValues };

/**
 * A table view's rows: its parts grouped per database instance (a group's parts are combined and
 * sorted together in its database), counted, and the page asked for taken walking the groups in
 * order — one group, one query. With RunOpts.values, a column's values instead of rows.
 * `source(parts, reads)` builds the table's row source; `reads` names the columns a query needs
 * ("all" for a page), so a count need not carry every column.
 */
export async function runRows(ctx: ViewRun, label: string, holders: string[], q: TableQuery, defaults: string[], shown: string[], size: number,
  source: (parts: TablePart[], reads: string[] | "all") => (db: string) => RowSource, values?: { column: string; numeric: boolean }): Promise<Rows> {
  type PL = Pick<PatientLevelCapable, "rowsPage" | "rowsCounts" | "rowsValues">;
  const groups: { resolver: PL; parts: TablePart[]; total: number }[] = [];
  const byConn = new Map<string, number>();
  for (const cn of ctx.vNames) for (const st of ctx.cohorts[cn].studies.filter((x) => holders.includes(x))) {
    const r = ctx.resolvers[st], k = r.instance.conn.id;
    if (!byConn.has(k)) { byConn.set(k, groups.length); groups.push({ resolver: r as unknown as PL, parts: [], total: 0 }); }
    groups[byConn.get(k)!].parts.push({ cohort: cn, study: st, cohortSql: r.cohortSql(ctx.doc.cohorts[cn]) });
  }
  const reads = queryReads(q, shown);
  if (values) {
    const got = await Promise.all(groups.map((g) => g.resolver.rowsValues(label + ":values", source(g.parts, [...reads, values.column]), q, defaults, values.column)));
    return { rows: [], lists: [], total: 0, all: 0, offset: 0, groups: groups.length, values: mergeValues(values.column, values.numeric, got as Record<string, unknown>[][]) };
  }
  const lists: Rows["lists"] = [];
  let all = 0;
  await Promise.all(groups.map(async (g) => {
    const counts = await g.resolver.rowsCounts(label + ":counts", source(g.parts, reads), q, defaults);
    for (const p of g.parts) {
      const c = counts.find((x) => x.cohort === p.cohort && x.study === p.study);
      lists.push({ cohort: p.cohort, study: p.study, total: c?.n || 0, all: c?.all || 0 });
      g.total += c?.n || 0; all += c?.all || 0;
    }
  }));
  const total = groups.reduce((n, g) => n + g.total, 0);
  const want = ctx.page ? { offset: Math.max(0, Math.floor(ctx.page.offset)), limit: Math.min(TABLE_CHUNK, Math.max(1, Math.floor(ctx.page.limit))) } : { offset: 0, limit: size };
  const rows: Record<string, unknown>[] = [];
  let skip = want.offset;
  for (const g of groups) {
    if (rows.length >= want.limit) break;
    if (skip >= g.total) { skip -= g.total; continue; }
    const page = await g.resolver.rowsPage(label + ":rows", source(g.parts, "all"), q, defaults, want.limit - rows.length, skip);
    rows.push(...page.rows); skip = 0;
  }
  const order = (l: { cohort: string; study: string }) => ctx.vNames.indexOf(l.cohort) * 1000 + ctx.vStudies.indexOf(l.study);
  lists.sort((a, b) => order(a) - order(b));
  return { rows, lists, total, all, offset: want.offset, groups: groups.length };
}

/** A view's query as the document gives it, with an older `sort.attribute` read as `sort.column`. */
export function viewQuery(view: TableQuery & { attributes?: string[]; sort?: { column?: string; attribute?: string; desc?: boolean } }): TableQuery {
  const s = view.sort as { column?: string; attribute?: string; desc?: boolean } | undefined;
  const column = s ? s.column || s.attribute : undefined;
  return cleanQuery({
    columns: view.columns || view.attributes,
    search: view.search,
    filters: view.filters,
    sort: column ? { column: String(column), ...(s!.desc ? { desc: true } : {}) } : undefined,
  });
}

/** The words every table view's caveat ends with: the order, the query, the paging, the databases, who is left out. */
export function tableTail(r: Rows, q: TableQuery, cols: { id: string; name: string }[], what: string, defaultOrder: string, excluded: { study: string; reason: string; patients: number }[], multiCohort: boolean): string {
  const sortCol = q.sort ? cols.find((c) => c.id === q.sort!.column) : null;
  const filtered = describeQuery(q, cols);
  return (filtered ? "Showing " + r.total.toLocaleString("en-US") + " of " + plural(r.all, what) + ": " + filtered + ". " : plural(r.total, what) + ". ") +
    "Sorted " + (sortCol ? "by " + sortCol.name + (q.sort!.desc ? " (highest first)" : "") + ", missing values last," : defaultOrder) +
    " across " + (r.lists.length > 1 ? "every cohort and study together" : "the cohort") + "; every page is a slice of that one order, and the download holds every row kept, with every column. " +
    (r.groups > 1 ? "These studies live in " + r.groups + " separate databases, so each database's rows are sorted together and listed in turn. " : "") +
    (multiCohort ? "A patient in two cohorts is listed under each. " : "") +
    (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + "; " + plural(e.patients, "patient") + " in these cohorts)").join(", ") + "." : "");
}
