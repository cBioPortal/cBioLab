// Table views: what every view that lists rows (the clinical table, the mutation table, and any
// later one) shares — which columns are shown, a search across them, per-column filters, a sort,
// and pages of one global order — compiled to SQL around the table's own row source.
//
// A table supplies only its rows: a RowSource is "WITH …, rows AS (…)" plus how each column reads
// off `rows`. Everything here is pure SQL text; the row sources themselves live beside their tables
// (lib/clinical-table.ts, lib/mutation-table.ts), outside lib/federation*.ts, and run only through
// PatientLevelResolver's rows* methods — a participant that may not disclose patients has none.
//
// The query (TableQuery) is part of the view's spec, so a shared document reproduces the filtered,
// sorted table; the page is the reader's and is not.
import { sq } from "./compiler.ts";
import { patientSql, type PatientSql } from "./sql-kinds.ts";

export type TextFilterOp = "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "regex";
export const TEXT_FILTER_OPS: readonly TextFilterOp[] = ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "regex"];

/** One column's filter: a text condition, a set of exact values, or a numeric range (inclusive). */
export type ColumnFilter =
  | { op: TextFilterOp; value: string }
  | { values: string[] }
  | { min?: number; max?: number };

/** The part of a table view's spec every table shares. */
export interface TableQuery {
  /** the columns shown, in order (default: the table's own default set); the download holds every column */
  columns?: string[];
  /** rows with this text, case-insensitive, in any shown column */
  search?: string;
  /** per column id; a row is kept when it passes every filter */
  filters?: Record<string, ColumnFilter>;
  /** missing values sort last either way */
  sort?: { column: string; desc?: boolean };
}

/** How a table's column reads off its `rows`. */
export interface QueryColumn {
  id: string; name: string; numeric: boolean;
  /** the column as text: what search and text filters match, and what a value list lists */
  text: string;
  /** numeric columns: the value as a number (NULL when missing) — range filters and sorting */
  num?: string;
  /** an order other than text/num (protein change by codon, say) */
  order?: string;
}

/** A table's rows. `with` defines `rows`, which carries `cohort` and `study` columns. */
export interface RowSource {
  with: string;
  columns: QueryColumn[];
  /** what each row of a page selects from `rows` */
  select: string;
  /** the order with no sort asked */
  defaultOrder: string;
  /** after any sort, so the order is total and every page and the download agree */
  tiebreak: string;
}

export const SEARCH_MAX = 200;
export const FILTER_VALUES_MAX = 500;
/** a value list returns at most this many distinct values, the most frequent first */
export const VALUES_MAX = 500;

/** The columns a query shows: its own list, or the default. Unknown ids are dropped (checkQuery reports them). */
export function shownColumns(q: TableQuery, all: { id: string }[], defaults: string[]): string[] {
  const ids = (q.columns && q.columns.length ? q.columns : defaults).filter((id) => all.some((c) => c.id === id));
  return ids.length ? ids : all.map((c) => c.id);
}

/**
 * What is wrong with a query against these columns, or null. Each message names the problem and
 * what would be accepted, since an assistant writes these as often as a person clicks them.
 */
export function checkQuery(q: TableQuery, all: { id: string; numeric: boolean }[]): string | null {
  const ids = all.map((c) => c.id);
  const known = (id: string) => ids.includes(id);
  const list = () => ids.length > 40 ? ids.slice(0, 40).join(", ") + ", …" : ids.join(", ");
  if (q.columns != null) {
    if (!Array.isArray(q.columns) || q.columns.some((c) => typeof c !== "string")) return "columns is a list of column ids";
    const bad = q.columns.filter((c) => !known(c));
    if (bad.length) return "unknown column " + bad.join(", ") + " — columns are " + list();
  }
  if (q.search != null && (typeof q.search !== "string" || q.search.length > SEARCH_MAX)) return "search is text of at most " + SEARCH_MAX + " characters";
  if (q.sort != null) {
    if (typeof q.sort !== "object" || typeof q.sort.column !== "string") return "sort is { column, desc? }";
    if (!known(q.sort.column)) return "sort.column " + q.sort.column + " is not a column — columns are " + list();
  }
  if (q.filters != null) {
    if (typeof q.filters !== "object" || Array.isArray(q.filters)) return "filters is an object keyed by column id";
    for (const [id, f] of Object.entries(q.filters)) {
      const col = all.find((c) => c.id === id);
      if (!col) return "filters." + id + ": not a column — columns are " + list();
      const e = checkFilter(f, col.numeric);
      if (e) return "filters." + id + ": " + e;
    }
  }
  return null;
}

function checkFilter(f: unknown, numeric: boolean): string | null {
  const shape = "a filter is { op, value }, { values: [...] } or { min?, max? }";
  if (!f || typeof f !== "object") return shape;
  const o = f as Record<string, unknown>;
  if (!["op", "values", "min", "max"].some((k) => k in o)) return shape;
  if ("min" in o || "max" in o) {
    if (!numeric) return "a range filter needs a numeric column; use { op, value } or { values } for text";
    for (const k of ["min", "max"] as const) if (o[k] != null && !Number.isFinite(Number(o[k])) || typeof o[k] === "string") return k + " is a number";
    if (o.min == null && o.max == null) return "a range filter needs min, max or both";
    if (o.min != null && o.max != null && Number(o.min) > Number(o.max)) return "min is above max";
    return null;
  }
  if (numeric) return "a numeric column takes a range filter { min?, max? }";
  if ("values" in o) {
    if (!Array.isArray(o.values) || o.values.some((v) => typeof v !== "string")) return "values is a list of text values";
    if (o.values.length > FILTER_VALUES_MAX) return "at most " + FILTER_VALUES_MAX + " values";
    return null;
  }
  if (!TEXT_FILTER_OPS.includes(o.op as TextFilterOp)) return "op is one of " + TEXT_FILTER_OPS.join(", ");
  if (typeof o.value !== "string" || o.value.length > SEARCH_MAX) return "value is text of at most " + SEARCH_MAX + " characters";
  if (o.op === "regex") { try { new RegExp(o.value); } catch { return "value is not a valid regular expression"; } }
  return null;
}

export function isRange(f: ColumnFilter): f is { min?: number; max?: number } { return "min" in f || "max" in f; }
export function isValues(f: ColumnFilter): f is { values: string[] } { return "values" in f; }

function textCond(x: string, f: { op: TextFilterOp; value: string }): string {
  const v = sq(f.value), lx = "lowerUTF8(" + x + ")", lv = "lowerUTF8(" + v + ")";
  switch (f.op) {
    case "contains": return "positionCaseInsensitiveUTF8(" + x + ", " + v + ") > 0";
    case "notContains": return "positionCaseInsensitiveUTF8(" + x + ", " + v + ") = 0";
    case "equals": return lx + " = " + lv;
    case "notEquals": return lx + " != " + lv;
    case "startsWith": return "startsWith(" + lx + ", " + lv + ")";
    case "endsWith": return "endsWith(" + lx + ", " + lv + ")";
    case "regex": return "match(" + x + ", " + v + ")";
  }
}

function filterCond(col: QueryColumn, f: ColumnFilter): string {
  if (isRange(f)) {
    const n = col.num || col.text, r = f;
    return [n + " IS NOT NULL", ...(r.min != null ? [n + " >= " + Number(r.min)] : []), ...(r.max != null ? [n + " <= " + Number(r.max)] : [])].join(" AND ");
  }
  if (isValues(f)) return f.values.length ? col.text + " IN (" + f.values.map(sq).join(", ") + ")" : "0";
  return textCond(col.text, f);
}

/** The rows a query keeps, as a WHERE condition over `rows` ("1" for all); `except` leaves one column's filter out. */
export function whereSql(src: RowSource, q: TableQuery, defaults: string[], except?: string): string {
  const conds: string[] = [];
  const s = (q.search || "").trim();
  if (s) {
    const shown = shownColumns(q, src.columns, defaults).map((id) => src.columns.find((c) => c.id === id)!);
    conds.push("(" + shown.map((c) => "positionCaseInsensitiveUTF8(" + c.text + ", " + sq(s) + ") > 0").join(" OR ") + ")");
  }
  for (const [id, f] of Object.entries(q.filters || {})) {
    if (id === except) continue;
    const col = src.columns.find((c) => c.id === id);
    if (col) conds.push("(" + filterCond(col, f) + ")");
  }
  return conds.length ? conds.join(" AND ") : "1";
}

function orderSql(src: RowSource, q: TableQuery): string {
  const col = q.sort && src.columns.find((c) => c.id === q.sort!.column);
  if (!col) return src.defaultOrder + ", " + src.tiebreak;
  const dir = q.sort!.desc ? "DESC" : "ASC";
  const by = col.order || col.num || col.text;
  // text: blanks last either way, then the value
  return (col.order || col.num ? by + " " + dir + " NULLS LAST" : "(" + by + " = '') ASC, " + by + " " + dir) + ", " + src.tiebreak;
}

/** One page of the query's rows, in its one order, with the count of every row it keeps. */
export function pageSql(src: RowSource, q: TableQuery, defaults: string[], limit: number, offset: number): PatientSql {
  return patientSql(src.with +
    "SELECT " + src.select + ", count() OVER () AS total FROM rows\n" +
    "WHERE " + whereSql(src, q, defaults) + "\n" +
    "ORDER BY " + orderSql(src, q) + "\n" +
    "LIMIT " + Math.max(0, Math.floor(limit)) + " OFFSET " + Math.max(0, Math.floor(offset)));
}

/**
 * Where one patient's row falls in the query's one order: its 0-based place among the rows kept
 * (`idx`), or no row when the query leaves it out. Assumes one row per study and patient, as a
 * one-cohort list of patients has.
 */
export function rankSql(src: RowSource, q: TableQuery, defaults: string[], study: string, patient: string): PatientSql {
  return patientSql(src.with +
    "SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY " + orderSql(src, q) + ") - 1 AS idx FROM rows\n" +
    "WHERE " + whereSql(src, q, defaults) + ")\n" +
    "WHERE study = " + sq(study) + " AND patient = " + sq(patient) + " LIMIT 1");
}

/** Per cohort and study: the rows the query keeps (`n`) and every row (`all`). Counts only. */
export function countsSql(src: RowSource, q: TableQuery, defaults: string[]): PatientSql {
  return patientSql(src.with + "SELECT cohort, study, countIf(" + whereSql(src, q, defaults) + ") AS n, count() AS all FROM rows GROUP BY cohort, study");
}

/**
 * The values one column takes among the rows the query keeps with that column's own filter left
 * out — what its filter offers: the distinct values with their counts (most frequent first), or a
 * numeric column's range. Counts only.
 */
export function valuesSql(src: RowSource, q: TableQuery, defaults: string[], column: string): PatientSql {
  const col = src.columns.find((c) => c.id === column);
  if (!col) throw new Error("unknown column " + column);
  const where = whereSql(src, q, defaults, column);
  return patientSql(col.numeric
    ? src.with + "SELECT min(v) AS lo, max(v) AS hi, count() AS n FROM (SELECT " + (col.num || col.text) + " AS v FROM rows WHERE " + where + ") WHERE v IS NOT NULL"
    : src.with + "SELECT v, count() AS n FROM (SELECT " + col.text + " AS v FROM rows WHERE " + where + ") GROUP BY v ORDER BY n DESC, v LIMIT " + VALUES_MAX);
}

/** A column's values, as valuesSql returns them, merged across databases. */
export type ColumnValues =
  | { column: string; numeric: false; values: { value: string; n: number }[]; truncated: boolean }
  | { column: string; numeric: true; min: number | null; max: number | null; n: number };

export function mergeValues(column: string, numeric: boolean, parts: Record<string, unknown>[][]): ColumnValues {
  if (numeric) {
    let min: number | null = null, max: number | null = null, n = 0;
    for (const rows of parts) for (const r of rows) {
      const c = Number(r.n) || 0;
      if (!c) continue;
      n += c;
      const lo = Number(r.lo), hi = Number(r.hi);
      if (min == null || lo < min) min = lo;
      if (max == null || hi > max) max = hi;
    }
    return { column, numeric: true, min, max, n };
  }
  const m = new Map<string, number>();
  let truncated = false;
  for (const rows of parts) {
    if (rows.length >= VALUES_MAX) truncated = true;
    for (const r of rows) m.set(String(r.v ?? ""), (m.get(String(r.v ?? "")) || 0) + (Number(r.n) || 0));
  }
  const values = [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || (a.value < b.value ? -1 : 1));
  return { column, numeric: false, values: values.slice(0, VALUES_MAX), truncated: truncated || values.length > VALUES_MAX };
}

/** The query in words, for a view's caveat and method record ("" when it keeps every row). */
export function describeQuery(q: TableQuery, all: { id: string; name: string }[]): string {
  const name = (id: string) => all.find((c) => c.id === id)?.name || id;
  const parts: string[] = [];
  const s = (q.search || "").trim();
  if (s) parts.push("containing “" + s + "” in a shown column");
  for (const [id, f] of Object.entries(q.filters || {})) {
    if (isRange(f)) {
      const r = f;
      parts.push(name(id) + (r.min != null && r.max != null ? " from " + r.min + " to " + r.max : r.min != null ? " ≥ " + r.min : " ≤ " + r.max));
    } else if (isValues(f)) {
      parts.push(name(id) + (f.values.length === 1 ? " = “" + f.values[0] + "”" : " one of " + f.values.slice(0, 6).map((v) => "“" + v + "”").join(", ") + (f.values.length > 6 ? " and " + (f.values.length - 6) + " more" : "")));
    } else {
      const words: Record<TextFilterOp, string> = { contains: "contains", notContains: "does not contain", equals: "is", notEquals: "is not",
        startsWith: "starts with", endsWith: "ends with", regex: "matches" };
      parts.push(name(id) + " " + words[f.op] + " " + (f.op === "regex" ? "/" + f.value + "/" : "“" + f.value + "”"));
    }
  }
  return parts.length ? "rows " + parts.join("; ") : "";
}

/** The query with nothing set dropped, so a cleared filter leaves the document as it was. */
export function cleanQuery<Q extends TableQuery>(q: Q): Q {
  const out = { ...q };
  if (!out.columns || !out.columns.length) delete out.columns;
  if (!out.search || !out.search.trim()) delete out.search;
  if (!out.filters || !Object.keys(out.filters).length) delete out.filters;
  if (!out.sort) delete out.sort;
  return out;
}

/** RFC 4180: a field with a comma, quote or line break is quoted, its quotes doubled. */
export function csvField(x: unknown): string {
  const s = x == null ? "" : String(x);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
