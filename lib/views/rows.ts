// What the table views share: their rows run in the database through lib/table-query.ts, paged
// across the participants that hold them.
import { isPatientLevel, type PatientLevelCapable, type RemoteTimelineRows, type Resolver } from "../federation.ts";
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

export type Rows = { rows: Record<string, unknown>[]; lists: { cohort: string; study: string; total: number; all: number }[]; total: number; all: number; offset: number; groups: number; values?: ColumnValues;
  /** with `locate`: the patient's place in the list's one order and the rows either side of it — null when the query leaves it out */
  position?: { index: number; prev: Record<string, unknown> | null; next: Record<string, unknown> | null } | null };

/**
 * A table view's rows: its parts grouped per database instance (a group's parts are combined and
 * sorted together in its database), counted, and the page asked for taken walking the groups in
 * order — one group, one query. With RunOpts.values, a column's values instead of rows.
 * `source(parts, reads)` builds the table's row source; `reads` names the columns a query needs
 * ("all" for a page), so a count need not carry every column. With `locate`, also where that
 * patient falls in the order and its neighbours (the timeline's prev / next).
 */
export async function runRows(ctx: ViewRun, label: string, holders: string[], q: TableQuery, defaults: string[], shown: string[], size: number,
  source: (parts: TablePart[], reads: string[] | "all") => (db: string) => RowSource, values?: { column: string; numeric: boolean },
  remote?: (r: Resolver) => RemoteTimelineRows | null, locate?: { study: string; patient: string }): Promise<Rows> {
  type PL = Pick<PatientLevelCapable, "rowsPage" | "rowsCounts" | "rowsValues" | "rowsRank">;
  // one backend per database — or per peer, for a view whose rows a peer may page itself (`remote`)
  type Backend = {
    page: (parts: TablePart[], limit: number, offset: number) => Promise<Record<string, unknown>[]>;
    counts: (parts: TablePart[], reads: string[]) => Promise<{ cohort: string; study: string; n: number; all: number }[]>;
    values: (parts: TablePart[], reads: string[], column: string) => Promise<Record<string, unknown>[]>;
    rank: (parts: TablePart[], study: string, patient: string) => Promise<number | null>;
  };
  const local = (r: PL): Backend => ({
    page: async (parts, limit, offset) => (await r.rowsPage(label + ":rows", source(parts, "all"), q, defaults, limit, offset)).rows,
    counts: (parts, reads) => r.rowsCounts(label + ":counts", source(parts, reads), q, defaults),
    values: (parts, reads, column) => r.rowsValues(label + ":values", source(parts, reads), q, defaults, column),
    rank: (parts, study, patient) => r.rowsRank(label + ":rank", source(parts, queryReads(q, shown)), q, defaults, study, patient),
  });
  const peer = (r: RemoteTimelineRows): Backend => {
    const defs = (parts: TablePart[]) => parts.map((p) => ({ cohort: p.cohort, def: ctx.doc.cohorts[p.cohort] }));
    return {
      page: async (parts, limit, offset) => (await r.timelineRows({ parts: defs(parts), query: q, defaults, mode: "page", limit, offset })).rows || [],
      counts: async (parts) => (await r.timelineRows({ parts: defs(parts), query: q, defaults, mode: "counts" })).counts || [],
      values: async (parts, _reads, column) => (await r.timelineRows({ parts: defs(parts), query: q, defaults, mode: "values", column })).values || [],
      rank: async (parts, _study, patient) => (await r.timelineRows({ parts: defs(parts), query: q, defaults, mode: "rank", patient })).rank ?? null,
    };
  };
  const groups: { backend: Backend; parts: TablePart[]; total: number }[] = [];
  const byKey = new Map<string, number>();
  for (const cn of ctx.vNames) for (const st of ctx.cohorts[cn].studies.filter((x) => holders.includes(x))) {
    const r = ctx.resolvers[st], rem = remote ? remote(r) : null;
    const k = rem ? "peer:" + rem.peerUrl : "db:" + r.instance.conn.id;
    if (!byKey.has(k)) { byKey.set(k, groups.length); groups.push({ backend: rem ? peer(rem) : local(r as unknown as PL), parts: [], total: 0 }); }
    groups[byKey.get(k)!].parts.push({ cohort: cn, study: st, cohortSql: rem ? "" : r.cohortSql(ctx.doc.cohorts[cn]) });
  }
  const reads = queryReads(q, shown);
  if (values) {
    const got = await Promise.all(groups.map((g) => g.backend.values(g.parts, [...reads, values.column], values.column)));
    return { rows: [], lists: [], total: 0, all: 0, offset: 0, groups: groups.length, values: mergeValues(values.column, values.numeric, got as Record<string, unknown>[][]) };
  }
  const lists: Rows["lists"] = [];
  let all = 0;
  await Promise.all(groups.map(async (g) => {
    const counts = await g.backend.counts(g.parts, reads);
    for (const p of g.parts) {
      const c = counts.find((x) => x.cohort === p.cohort && x.study === p.study);
      lists.push({ cohort: p.cohort, study: p.study, total: c?.n || 0, all: c?.all || 0 });
      g.total += c?.n || 0; all += c?.all || 0;
    }
  }));
  const total = groups.reduce((n, g) => n + g.total, 0);
  const want = ctx.page ? { offset: Math.max(0, Math.floor(ctx.page.offset)), limit: Math.min(TABLE_CHUNK, Math.max(1, Math.floor(ctx.page.limit))) } : { offset: 0, limit: size };
  // rows `offset` on, in the one order: each group's rows follow the groups before it
  const pageAt = async (offset: number, limit: number) => {
    const out: Record<string, unknown>[] = [];
    let skip = offset;
    for (const g of groups) {
      if (out.length >= limit) break;
      if (skip >= g.total) { skip -= g.total; continue; }
      out.push(...await g.backend.page(g.parts, limit - out.length, skip)); skip = 0;
    }
    return out;
  };
  const [rows, position] = await Promise.all([pageAt(want.offset, want.limit), locate ? (async () => {
    let before = 0;
    for (const g of groups) {
      // ranked among the whole group's rows: they are sorted together
      const at = g.total && g.parts.some((p) => p.study === locate.study) ? await g.backend.rank(g.parts, locate.study, locate.patient) : null;
      if (at != null) {
        const index = before + at;
        const near = await pageAt(Math.max(0, index - 1), index ? 3 : 2);
        return { index, prev: index ? near[0] ?? null : null, next: near[index ? 2 : 1] ?? null };
      }
      before += g.total;
    }
    return null;
  })() : Promise.resolve(undefined)]);
  const order = (l: { cohort: string; study: string }) => ctx.vNames.indexOf(l.cohort) * 1000 + ctx.vStudies.indexOf(l.study);
  lists.sort((a, b) => order(a) - order(b));
  return { rows, lists, total, all, offset: want.offset, groups: groups.length, ...(position !== undefined ? { position } : {}) };
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
