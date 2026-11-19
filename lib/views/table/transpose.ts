// The clinical data table on its side, as the portal's Patient page lists clinical data
// (ClinicalInformationPatientTable, ClinicalInformationSamplesTable): a row per attribute, in the
// study's order, and a column per patient or per sample. Pure, so the card draws it and a test reads it.
import { portalClinicalValue } from "../../chart/format.ts";
import type { TableResult } from "./types.ts";

const OWN = new Set(["patient", "sample", "samples"]);

export interface TransposedRow { id: string; name: string; values: string[] }

/**
 * The attributes as rows: a sample's own attributes only when the columns are samples, and an
 * attribute no one has left out. Values as the portal writes them: the patient table rounds a
 * non-integer number to one decimal (getDisplayValue: FRACTION_GENOME_ALTERED 0.4881 → "0.5"); the
 * samples table writes values as stored, "n/a" where a sample has none. With `sampleOrder` (the
 * page's sample order, ClinicalInformationSamplesTable's sampleManager order), the sample columns
 * follow it, any sample it does not name after them in the table's order.
 */
export function transposedRows(t: Pick<TableResult, "unit" | "columns" | "rows" | "patientAttrs">, sampleOrder?: readonly string[]): { heads: string[]; rows: TransposedRow[] } {
  const perSample = t.unit === "sample";
  const skip = new Set([...OWN, ...(perSample ? t.patientAttrs || [] : [])]);
  const at = (r: TableResult["rows"][number]) => { const i = sampleOrder ? sampleOrder.indexOf(r.sample) : -1; return i < 0 ? Infinity : i; };
  const cols = perSample && sampleOrder ? t.rows.map((r, k) => ({ r, k })).sort((a, b) => at(a.r) - at(b.r) || a.k - b.k).map((x) => x.r) : t.rows;
  const heads = cols.map((r) => String(perSample ? r.sample : r.patient));
  const rows = t.columns.map((c, i) => ({ c, raw: cols.map((r) => r.values[i] ?? "") }))
    .filter(({ c, raw }) => !skip.has(c.id) && raw.some((v) => v !== ""))
    .map(({ c, raw }) => ({ id: c.id, name: c.name, values: raw.map((v) => v === "" ? (perSample ? "n/a" : "") : perSample ? v : portalClinicalValue(v)) }));
  return { heads, rows };
}
