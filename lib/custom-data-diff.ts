// What a new version of an upload changes, against the version it replaces — browser-safe, pure.
//
// A new version is written only after its reader has seen this diff (app/lab/dataset-diff.tsx), and
// the server refuses one compared against a version that is no longer the latest
// (lib/custom-store.ts `baseVersion`), so every change a version makes was on screen when it was saved.
//
// Cases are keyed by study and id (the sample's at sample level, else the patient's). Values are
// compared where both versions have the case, in every column the new version has — a column it adds
// was empty before, so its values for kept cases are "filled in"; a NUMBER column compares numbers,
// so "80" and "80.0" are the same value and a round trip through an export changes nothing.
import type { CustomColumn, CustomDataset, CustomDatatype } from "./custom-data-names.ts";

type Side = Pick<CustomDataset, "name" | "level" | "columns" | "rows">;

export interface ValueChange { id: string; column: string; from: string; to: string }
export interface ColumnChanges {
  column: string;
  /** a value replaced by another */
  changed: number;
  /** empty before, a value now */
  filled: number;
  /** a value before, empty now */
  cleared: number;
  /** the first few of each, for the summary */
  examples: ValueChange[];
}
export interface DatasetDiff {
  name: { from: string; to: string } | null;
  columns: { added: CustomColumn[]; removed: CustomColumn[]; retyped: { name: string; from: CustomDatatype; to: CustomDatatype }[]; kept: number };
  cases: { added: string[]; removed: string[]; kept: number; before: number; after: number };
  studies: { added: string[]; removed: string[] };
  values: ColumnChanges[];
  /** every value change, for the full download */
  all: ValueChange[];
  /** nothing differs: saving would write the same data again */
  same: boolean;
  /** something present before is gone or reinterpreted: a case, a column, a value, a type */
  losesData: boolean;
}

const EXAMPLES = 5;

export function caseKey(level: CustomDataset["level"], r: CustomDataset["rows"][number]): string {
  return r.study + ":" + (level === "sample" ? r.sample : r.patient);
}

function sameValue(a: string, b: string, numeric: boolean): boolean {
  if (a === b) return true;
  if (!numeric || a === "" || b === "") return false;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

export function diffDatasets(before: Side, after: Side): DatasetDiff {
  if (before.level !== after.level) throw new Error("a " + before.level + "-level dataset cannot be compared with a " + after.level + "-level one");
  const oldCols = new Map(before.columns.map((c, i) => [c.name, { c, i }]));
  const newCols = new Map(after.columns.map((c, i) => [c.name, { c, i }]));
  const added = after.columns.filter((c) => !oldCols.has(c.name));
  const removed = before.columns.filter((c) => !newCols.has(c.name));
  const shared = after.columns.filter((c) => oldCols.has(c.name));
  const retyped = shared.filter((c) => oldCols.get(c.name)!.c.datatype !== c.datatype)
    .map((c) => ({ name: c.name, from: oldCols.get(c.name)!.c.datatype, to: c.datatype }));

  const oldRows = new Map(before.rows.map((r) => [caseKey(before.level, r), r]));
  const newRows = new Map(after.rows.map((r) => [caseKey(after.level, r), r]));
  const addedCases = [...newRows.keys()].filter((k) => !oldRows.has(k));
  const removedCases = [...oldRows.keys()].filter((k) => !newRows.has(k));

  const compared = after.columns;
  const values: ColumnChanges[] = compared.map((c) => ({ column: c.name, changed: 0, filled: 0, cleared: 0, examples: [] }));
  const all: ValueChange[] = [];
  let kept = 0;
  for (const [k, nr] of newRows) {
    const or = oldRows.get(k);
    if (!or) continue;
    kept++;
    compared.forEach((c, j) => {
      const old = oldCols.get(c.name);
      const from = old ? or.values[old.i] ?? "" : "", to = nr.values[newCols.get(c.name)!.i] ?? "";
      const numeric = c.datatype === "NUMBER" && old?.c.datatype === "NUMBER";
      if (sameValue(from, to, numeric)) return;
      const v = values[j];
      if (from === "") v.filled++; else if (to === "") v.cleared++; else v.changed++;
      const ch = { id: k, column: c.name, from, to };
      if (v.examples.length < EXAMPLES) v.examples.push(ch);
      all.push(ch);
    });
  }

  const studiesOf = (s: Side) => new Set(s.rows.map((r) => r.study));
  const os = studiesOf(before), ns = studiesOf(after);
  const name = before.name !== after.name ? { from: before.name, to: after.name } : null;
  const changedValues = values.filter((v) => v.changed + v.filled + v.cleared > 0);
  return {
    name,
    columns: { added, removed, retyped, kept: shared.length },
    cases: { added: addedCases, removed: removedCases, kept, before: oldRows.size, after: newRows.size },
    studies: { added: [...ns].filter((s) => !os.has(s)).sort(), removed: [...os].filter((s) => !ns.has(s)).sort() },
    values: changedValues,
    all,
    same: !name && !added.length && !removed.length && !retyped.length && !addedCases.length && !removedCases.length && !changedValues.length,
    losesData: removed.length > 0 || retyped.length > 0 || removedCases.length > 0 || changedValues.some((v) => v.changed + v.cleared > 0)
  };
}

const plural = (n: number, one: string, many = one + "s") => n.toLocaleString("en-US") + " " + (n === 1 ? one : many);

/** The diff as sentences, most consequential first: what the summary leads with, and what a caption or log can carry. */
export function diffSentences(d: DatasetDiff, level: CustomDataset["level"]): string[] {
  if (d.same) return ["No changes: the data is identical to the saved version."];
  const out: string[] = [];
  if (d.cases.removed.length) out.push(plural(d.cases.removed.length, level) + " removed (of " + d.cases.before.toLocaleString("en-US") + ")");
  if (d.columns.removed.length) out.push(plural(d.columns.removed.length, "column") + " removed: " + d.columns.removed.map((c) => c.name).join(", "));
  for (const r of d.columns.retyped) out.push(r.name + " changes type: " + typeLabel(r.from) + " → " + typeLabel(r.to));
  for (const v of d.values) {
    const parts = [v.changed && plural(v.changed, "value") + " changed", v.cleared && plural(v.cleared, "value") + " cleared", v.filled && plural(v.filled, "value") + " filled in"].filter(Boolean);
    out.push(v.column + ": " + parts.join(", "));
  }
  if (d.cases.added.length) out.push(plural(d.cases.added.length, level) + " added");
  if (d.columns.added.length) out.push(plural(d.columns.added.length, "column") + " added: " + d.columns.added.map((c) => c.name).join(", "));
  if (d.studies.added.length) out.push("now also in " + d.studies.added.join(", "));
  if (d.studies.removed.length) out.push("no longer in " + d.studies.removed.join(", "));
  if (d.name) out.push("renamed “" + d.name.from + "” → “" + d.name.to + "”");
  return out;
}

export function typeLabel(t: CustomDatatype): string { return t === "NUMBER" ? "numeric" : "categorical"; }

/** Every change, one per line, for the reader to check in full: cases, columns, then values. */
export function diffToTsv(d: DatasetDiff): string {
  const lines = ["CHANGE\tCASE\tCOLUMN\tBEFORE\tAFTER"];
  for (const k of d.cases.removed) lines.push("case removed\t" + k + "\t\t\t");
  for (const k of d.cases.added) lines.push("case added\t" + k + "\t\t\t");
  for (const c of d.columns.removed) lines.push("column removed\t\t" + c.name + "\t" + typeLabel(c.datatype) + "\t");
  for (const c of d.columns.added) lines.push("column added\t\t" + c.name + "\t\t" + typeLabel(c.datatype));
  for (const r of d.columns.retyped) lines.push("type changed\t\t" + r.name + "\t" + typeLabel(r.from) + "\t" + typeLabel(r.to));
  for (const v of d.all) lines.push((v.from === "" ? "value filled" : v.to === "" ? "value cleared" : "value changed") + "\t" + v.id + "\t" + v.column + "\t" + v.from + "\t" + v.to);
  return lines.join("\n") + "\n";
}
