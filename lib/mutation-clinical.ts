// The mutation table's clinical-attribute columns (MUT-COL-36): one per attribute the queried studies record,
// as the portal's Results table adds them (ResultsViewMutationTable, mutationsTabClinicalAttributes), hidden by
// default. A sample attribute reads the row's sample, a patient attribute its patient. Browser-safe: it builds
// SQL text and reads values, nothing else.
import { sq } from "./compiler.ts";
import { finiteSql } from "./sql-number.ts";
import type { QueryColumn } from "./table-query.ts";

/** an attribute as a column: its id (the column's id, as the portal's), display name, whose it is and its type */
export interface ClinicalColumn { id: string; name: string; per: "patient" | "sample"; numeric: boolean }

/**
 * Attributes the table already shows as columns of its own, so not repeated: Cancer Type Detailed and
 * # Mut in Sample (the portal leaves these two out too), and CANCER_TYPE, our Cancer Type column.
 */
export const CLINICAL_SKIP: ReadonlySet<string> = new Set(["CANCER_TYPE_DETAILED", "MUTATION_COUNT", "CANCER_TYPE"]);

/** the row field each map is selected as */
export const CLIN_SAMPLE = "clinS", CLIN_PATIENT = "clinP";

/**
 * The queried studies' attributes as columns, each once (the first study's description of it wins), in the
 * order the studies list them, without CLINICAL_SKIP and without an id the table already uses.
 */
export function clinicalColumns(perStudy: Record<string, unknown>[][], taken: ReadonlySet<string>): ClinicalColumn[] {
  const out: ClinicalColumn[] = [];
  for (const rows of perStudy) for (const m of rows) {
    const id = String(m.id ?? "");
    if (!id || CLINICAL_SKIP.has(id) || taken.has(id) || out.some((c) => c.id === id)) continue;
    out.push({ id, name: String(m.name || id), per: Number(m.patient) === 1 ? "patient" : "sample", numeric: String(m.datatype ?? "").toUpperCase() === "NUMBER" });
  }
  return out;
}

/** how the table reads a clinical column off its rows: the value as text ('' for none), a NUMBER attribute also as a number */
export function clinicalQueryColumn(c: ClinicalColumn): QueryColumn {
  // a study records the attribute for its samples or its patients (two studies may differ): the sample's value, else the patient's
  const at = (map: string) => "ifNull(" + map + "[" + sq(c.id) + "], '')";
  const text = "if(" + at(CLIN_SAMPLE) + " != '', " + at(CLIN_SAMPLE) + ", " + at(CLIN_PATIENT) + ")";
  return { id: c.id, name: c.name, numeric: c.numeric, text, ...(c.numeric ? { num: finiteSql("nullIf(" + text + ", '')") } : {}) };
}

/** a row's value of a clinical column, from the maps the row source selected (the sample's, else the patient's): a number for a NUMBER attribute, else the text; null for none */
export function clinicalValue(row: Record<string, unknown>, c: ClinicalColumn): string | number | null {
  const of = (field: string) => { const m = row[field] as Record<string, unknown> | null | undefined; return m && typeof m === "object" ? m[c.id] : undefined; };
  const s = of(CLIN_SAMPLE);
  const v = s != null && s !== "" ? s : of(CLIN_PATIENT);
  if (v == null || v === "") return null;
  if (c.numeric) { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  return String(v);
}
