// A patient's samples with their own clinical attributes, read where the patient lives, as the
// clinical table reads them: the timeline's sample tooltip (PAT-TL-TT-3) and the Genomic Evolution
// line chart's Group by (PTB-GE-LC-5) list them as the portal's SampleManager does.
import type { PatientLevelCapable } from "./federation.ts";
import type { TablePart } from "./mutation-table.ts";
import { clinicalRowSource, tableAttributesSql } from "./clinical-table.ts";
import type { ViewResolver } from "./views/shared.ts";

/** at most this many samples of one patient are read */
const SAMPLES_MAX = 1000;

export interface PatientSampleAttributes {
  /** the study's sample-level attributes, in the study's order: id and display name */
  columns: { id: string; name: string }[];
  /** each sample's own values, by sample id: [attribute id, value], in `columns` order, empty values left out */
  bySample: Record<string, [string, string][]>;
}

/** Each of `patient`'s samples with its own clinical attributes (not its patient's). Throws when they cannot be read. */
export async function patientSampleAttributes(res: ViewResolver & PatientLevelCapable, study: string, patient: string, label = "timeline:sample-attributes"): Promise<PatientSampleAttributes> {
  const meta = await res.viewMeta("table:attributes", tableAttributesSql);
  const cols = meta.filter((m) => Number(m.patient) !== 1).map((m) => ({ id: String(m.id), name: String(m.name || m.id), per: "sample" as const, numeric: false }));
  if (!cols.length) return { columns: [], bySample: {} };
  const parts: TablePart[] = [{ cohort: "patient", study, cohortSql: res.cohortSql({ study, all: [{ kind: "patientList", ids: [study + ":" + patient] }] }) }];
  const page = await res.rowsPage(label, (db) => clinicalRowSource(parts, db, "sample", cols), {}, ["patient", "sample"], SAMPLES_MAX, 0);
  const bySample: Record<string, [string, string][]> = {};
  for (const r of page.rows) {
    const m = (r.m || {}) as Record<string, string>;
    bySample[String(r.sample)] = cols.map((c) => [c.id, m[c.id] ?? ""] as [string, string]).filter(([, v]) => v !== "");
  }
  return { columns: cols.map((c) => ({ id: c.id, name: c.name })), bySample };
}
