// THE rule for who enters a survival analysis and what counts as an event, as cBioPortal's frontend
// applies it (getPatientSurvivals, SurvivalStoreHelper.ts, shared by its study view, results view and
// group comparison). A patient enters only with BOTH a status and a months value, neither one of the
// portal's missing markers, and months a number of at least 0; a patient with months but no status is
// left out, never counted as censored. The event is a status whose code, the part before any ":", is
// 1: "1:DECEASED" as the portal reads it, and also a bare "1" or "1.0", which some studies' status
// columns hold (ucec_msk_2018 PROGRESSION_STATUS) and the portal would read as censored. The time and
// status belong to the patient: an uploaded sample-level outcome column is read through the patient's
// samples, which must agree (endpointRowsSql, endpointValueSql). Browser-safe: it only builds SQL text.
import { finiteSql } from "./sql-number.ts";
import { sq } from "./compiler.ts";
import { isCustomAttr } from "./custom-data-names.ts";

/** the values cBioPortal reads as a missing survival status or time, compared trimmed and lower-cased */
export const SURVIVAL_NULL_VALUES = ["[not applicable]", "[not available]", "[pending]", "[discrepancy]", "[completed]", "[null]", "", "na"];

/** true when a status (or months) value is recorded: not one of the portal's missing markers */
export const survivalPresentSql = (expr: string): string =>
  "lowerUTF8(trimBoth(ifNull(" + expr + ", ''))) NOT IN (" + SURVIVAL_NULL_VALUES.map((v) => "'" + v + "'").join(", ") + ")";

/** true when a months value is usable: recorded, and a number of at least 0 */
export const survivalTimeUsableSql = (months: string): string =>
  survivalPresentSql(months) + " AND " + finiteSql("trimBoth(" + months + ")") + " >= 0";

/** the survival time in months, or NULL when the patient does not enter: missing status or months, or months not a number ≥ 0 */
export function survivalMonthsSql(months: string, status: string): string {
  return "if(" + survivalPresentSql(status) + " AND " + survivalTimeUsableSql(months) + ", " + finiteSql("trimBoth(" + months + ")") + ", NULL)";
}

/** 1 when the status's code records the event ("1:DECEASED", "1:Progressed", "1", "1.0"), else 0 */
export function survivalEventSql(status: string): string {
  return "if(" + finiteSql("trimBoth(splitByChar(':', ifNull(" + status + ", ''))[1])") + " = 1, 1, 0)";
}

/**
 * Which clinical rows hold an endpoint's months and status. A study's own outcome columns are
 * patient-level; an uploaded one may be sample-level (its file was keyed by SAMPLE_ID), and is then
 * read per patient through its samples, which must agree (endpointValueSql). `plain` is the filter
 * as the caller writes it, returned unchanged when neither column is uploaded.
 */
export function endpointRowsSql(months: string, status: string, plain: string): string {
  const custom = [...new Set([months, status].filter(isCustomAttr))];
  if (!custom.length) return plain;
  return "(type = 'patient' OR type = 'sample' AND attribute_name IN (" + custom.map(sq).join(", ") + "))";
}

/**
 * One patient's value of an endpoint column, inside a GROUP BY patient. For an uploaded column the
 * patient's samples must hold one value between them: a survival time and status belong to the
 * patient, and picking one sample's would answer a question nobody asked, so a patient whose
 * samples disagree fails the query. `eq` keeps the caller's spelling of "=" for the study's own
 * columns.
 */
export function endpointValueSql(attr: string, eq = "="): string {
  const plain = "anyIf(attribute_value, attribute_name" + eq + sq(attr) + ")";
  if (!isCustomAttr(attr)) return plain;
  const refusal = "a patient's samples hold different values of " + attr +
    ": a survival endpoint needs one value per patient (upload the outcome keyed by PATIENT_ID, or make each patient's samples agree)";
  return "if(throwIf(uniqExactIf(trimBoth(attribute_value), attribute_name = " + sq(attr) + ") > 1, " + sq(refusal) + ") = 0, " +
    "anyIf(attribute_value, attribute_name = " + sq(attr) + "), '')";
}
