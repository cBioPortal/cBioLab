// A stored upload as an editable table — browser-safe, pure. The editor (app/_saved/dataset-editor.tsx)
// holds one of these, and what it would save is `toDataset` of it, compared against the stored
// version (lib/custom-data-diff.ts) before it is.
//
// Editing adds and updates, never removes: every row and column of the stored version stays, a value
// can be changed, and rows and columns can be added — typed in, or merged from a file (`mergeRows`:
// an id already there updates that row, a new one is a new row). The server holds a new version to
// the same rule (lib/custom-store.ts). A row the reader types carries its id (`newId`) until it is
// matched to a case of the dataset's studies (`matches`).
import { caseKey } from "./custom-data-diff.ts";
import type { CustomColumn, CustomDataset, CustomDatatype, CustomRow } from "./custom-data-names.ts";

export interface EditRow extends CustomRow {
  key: string;
  /** an added row: the id typed for it, matched to a case on review */
  newId?: string;
}
/** `asText`: a column added from a file whose upload chose categorical for numbers */
export interface Working { columns: (CustomColumn & { asText?: boolean })[]; rows: EditRow[] }
/** an added row's id, matched: none, one case, or one per study it exists in */
export type Matches = Map<string, { study: string; patient: string; sample?: string }[]>;

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const COLUMN_RE = /^[A-Z0-9_]{1,60}$/;
let added = 0;

export function working(d: Pick<CustomDataset, "level" | "columns" | "rows">): Working {
  return { columns: d.columns.map((c) => ({ ...c })), rows: d.rows.map((r) => ({ ...r, values: [...r.values], key: caseKey(d.level, r) })) };
}

export function setCell(w: Working, key: string, column: string, v: string): Working {
  const j = w.columns.findIndex((c) => c.name === column);
  if (j < 0) return w;
  return { ...w, rows: w.rows.map((r) => r.key === key ? { ...r, values: r.values.map((x, i) => i === j ? v.trim() : x) } : r) };
}

/** an added row taken out again (the editor offers it only for rows the stored version lacks) */
export function dropRow(w: Working, key: string): Working {
  return { ...w, rows: w.rows.filter((r) => r.key !== key) };
}

/**
 * Rows from a file merged into the table: a case already there takes the file's values for the
 * file's columns, a new case is a new row, and every other row, column and value stays. A blank in
 * the file leaves the value it would replace. Columns the table lacks are added.
 */
export function mergeRows(w: Working, level: CustomDataset["level"], incoming: Pick<CustomDataset, "columns" | "rows">): Working {
  const columns = [...w.columns];
  const at = incoming.columns.map((c) => {
    const j = columns.findIndex((x) => x.name === c.name);
    if (j >= 0) return j;
    columns.push({ ...c, ...(c.datatype === "STRING" ? { asText: true } : {}) });
    return columns.length - 1;
  });
  const pad = (v: string[]) => [...v, ...Array(columns.length - v.length).fill("")];
  const rows = w.rows.map((r) => ({ ...r, values: pad(r.values) }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const r of incoming.rows) {
    const key = caseKey(level, r);
    let row = byKey.get(key);
    if (!row) {
      row = { key, study: r.study, patient: r.patient, ...(r.sample !== undefined ? { sample: r.sample } : {}), values: pad([]) };
      rows.push(row); byKey.set(key, row);
    }
    r.values.forEach((v, j) => { if (v !== "" && at[j] !== undefined) row.values[at[j]] = v; });
  }
  return { columns, rows };
}

export function addRow(w: Working, study: string): Working {
  return { ...w, rows: [{ key: "new:" + ++added, study, patient: "", newId: "", values: w.columns.map(() => "") }, ...w.rows] };
}

export function setNewId(w: Working, key: string, id: string): Working {
  return { ...w, rows: w.rows.map((r) => r.key === key ? { ...r, newId: id.trim() } : r) };
}

/** a column name as an upload's header becomes one: upper case, letters, digits and underscores */
export function columnName(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function addColumn(w: Working, raw: string): Working {
  const name = columnName(raw);
  if (!COLUMN_RE.test(name)) throw new Error("a column needs a name of letters, digits and underscores");
  if (w.columns.some((c) => c.name === name)) throw new Error(name + " is already a column");
  return { columns: [...w.columns, { name, datatype: "STRING" }], rows: w.rows.map((r) => ({ ...r, values: [...r.values, ""] })) };
}

/** Numeric while every value is a number; a column that was categorical stays so. */
export function columnType(was: CustomDatatype | undefined, values: string[]): CustomDatatype {
  if (was === "STRING") return "STRING";
  const filled = values.filter((v) => v !== "");
  if (!filled.length) return was ?? "STRING";
  return filled.every((v) => NUMBER_RE.test(v)) ? "NUMBER" : "STRING";
}

/** What is wrong with each added row, by key: an id not typed, matching no case, or a case the table already has. */
export function addedRowProblems(w: Working, level: CustomDataset["level"], matches: Matches | null): Map<string, string> {
  const out = new Map<string, string>();
  const have = new Set(w.rows.filter((r) => r.newId === undefined).map((r) => r.key));
  for (const r of w.rows) {
    if (r.newId === undefined) continue;
    if (!r.newId) { out.set(r.key, "type its " + level + " id"); continue; }
    const m = matches?.get(r.key);
    if (!m) continue;
    if (!m.length) { out.set(r.key, "no " + level + " " + r.newId + " in this dataset's studies"); continue; }
    const k = m.map((x) => x.study + ":" + (level === "sample" ? x.sample : x.patient)).find((x) => have.has(x));
    if (k) out.set(r.key, k + " is already in the table");
    else for (const x of m) have.add(x.study + ":" + (level === "sample" ? x.sample : x.patient));
  }
  return out;
}

/** The table as the dataset it would save: typed rows as the cases they matched (unmatched ones left out). */
export function toDataset<D extends Pick<CustomDataset, "id" | "level" | "columns">>(base: D, w: Working, name: string, matches: Matches | null): D & Pick<CustomDataset, "name" | "columns" | "rows"> {
  const was = new Map(base.columns.map((c) => [c.name, c.datatype]));
  const columns = w.columns.map((c, j) => ({ name: c.name, datatype: columnType(c.asText ? "STRING" : was.get(c.name), w.rows.map((r) => r.values[j])) }));
  const rows: CustomRow[] = [];
  for (const r of w.rows) {
    const values = [...r.values];
    if (r.newId === undefined) rows.push({ study: r.study, patient: r.patient, ...(r.sample !== undefined ? { sample: r.sample } : {}), values });
    else for (const m of matches?.get(r.key) ?? []) rows.push({ ...m, values });
  }
  return { ...base, name: name.trim() || base.id, columns, rows };
}

/** An upload as the next version of a stored dataset: merged into it, so every stored row and column stays. */
export function mergeDataset<D extends Pick<CustomDataset, "id" | "level" | "columns" | "rows">>(base: D, incoming: Pick<CustomDataset, "name" | "columns" | "rows">): D & Pick<CustomDataset, "name" | "columns" | "rows"> {
  return toDataset(base, mergeRows(working(base), base.level, incoming), incoming.name, null);
}

/** What a new version leaves out of the one it follows — refused, since editing only adds and updates. */
export function lostFrom(prev: Pick<CustomDataset, "level" | "columns" | "rows">, next: Pick<CustomDataset, "columns" | "rows">): { columns: string[]; cases: string[] } {
  const have = new Set(next.rows.map((r) => caseKey(prev.level, r)));
  return {
    columns: prev.columns.filter((c) => !next.columns.some((x) => x.name === c.name)).map((c) => c.name),
    cases: prev.rows.map((r) => caseKey(prev.level, r)).filter((k) => !have.has(k))
  };
}
