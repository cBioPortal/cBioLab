// THE rule for who enters a survival analysis and what counts as an event, as cBioPortal's frontend
// applies it (getPatientSurvivals, SurvivalStoreHelper.ts, shared by its study view, results view and
// group comparison). A patient enters only with BOTH a status and a months value, neither one of the
// portal's missing markers, and months a number of at least 0; a patient with months but no status is
// left out, never counted as censored. The event is a status whose code, the part before any ":", is
// 1: "1:DECEASED" as the portal reads it, and also a bare "1" or "1.0", which some studies' status
// columns hold (ucec_msk_2018 PROGRESSION_STATUS) and the portal would read as censored. Browser-safe:
// it only builds SQL text.
import { finiteSql } from "./sql-number.ts";

/** the values cBioPortal reads as a missing survival status or time, compared trimmed and lower-cased */
export const SURVIVAL_NULL_VALUES = ["[not applicable]", "[not available]", "[pending]", "[discrepancy]", "[completed]", "[null]", "", "na"];

const present = (expr: string): string =>
  "lowerUTF8(trimBoth(ifNull(" + expr + ", ''))) NOT IN (" + SURVIVAL_NULL_VALUES.map((v) => "'" + v + "'").join(", ") + ")";

/** the survival time in months, or NULL when the patient does not enter: missing status or months, or months not a number ≥ 0 */
export function survivalMonthsSql(months: string, status: string): string {
  const m = finiteSql("trimBoth(" + months + ")");
  return "if(" + present(status) + " AND " + present(months) + " AND " + m + " >= 0, " + m + ", NULL)";
}

/** 1 when the status's code records the event ("1:DECEASED", "1:Progressed", "1", "1.0"), else 0 */
export function survivalEventSql(status: string): string {
  return "if(" + finiteSql("trimBoth(splitByChar(':', ifNull(" + status + ", ''))[1])") + " = 1, 1, 0)";
}
