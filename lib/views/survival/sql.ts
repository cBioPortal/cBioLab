// The survival view's own SQL: what its runner (run.ts) asks each participant's database for, beside
// the (months, event, n) counts every participant answers (survivalCountsSql, lib/federation.ts).
import { sq } from "../../compiler.ts";
import { clinicalTable } from "../../custom-data.ts";
import { inCohortPatients } from "../../cohort2.ts";
import { survivalPresentSql, survivalTimeUsableSql } from "../../survival-sql.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Of the cohort's patients, how many a survival curve leaves out for want of half an endpoint: a
 * usable time but no status (no_status), and a status but no usable time (no_time) — the rule of
 * lib/survival-sql.ts. Patients with neither are not counted here. Counts only.
 */
export function survivalLeftOutSql(cohortSql: string, study: string, db: string, months: string, status: string): AggregateSql {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(months) + ") AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient'\n" +
    "    AND attribute_name IN (" + sq(months) + ", " + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT countIf(" + survivalTimeUsableSql("months") + " AND NOT " + survivalPresentSql("status") + ") AS no_status,\n" +
    "       countIf(" + survivalPresentSql("status") + " AND NOT (" + survivalTimeUsableSql("months") + ")) AS no_time\n" +
    "FROM os"
  ));
}
