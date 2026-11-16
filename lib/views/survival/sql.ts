// The survival view's own SQL: what its runner (run.ts) asks each participant's database for
// beyond the survival counts themselves.
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { sq } from "../../compiler.ts";
import { clinicalMetaTable } from "../../custom-data.ts";

/**
 * How many of the study's patients are in more than one of the cohorts, as one count (column n).
 * A patient in two curves breaks the log-rank test's assumption that the groups are independent,
 * so the runner gives no p when this is above 0. Patients, not samples: a patient is in a curve
 * when any of its samples is in the cohort.
 */
export function sharedPatientsSql(cohortSqls: string[]): AggregateSql {
  if (cohortSqls.length < 2) throw new Error("sharedPatientsSql needs at least two cohorts");
  const ctes = cohortSqls.map((c, i) => "c" + i + " AS (" + c + ")").join(",\n");
  const each = cohortSqls.map((_, i) => "SELECT DISTINCT pid FROM c" + i).join(" UNION ALL ");
  return aggregateSql("WITH " + ctes + "\nSELECT count() AS n FROM (SELECT pid FROM (" + each + ") GROUP BY pid HAVING count() > 1)");
}

/**
 * Each <X>_STATUS attribute the study declares, with its display name and priority: the survival-type
 * table's titles and order (metadata only).
 */
export function survivalStatusMetaSql(study: string, db: string): AggregateSql {
  return aggregateSql(
    "SELECT cam.attr_id AS a, any(cam.display_name) AS label, max(toInt64OrZero(toString(cam.priority))) AS priority\n" +
    "FROM " + clinicalMetaTable(db) + " cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND cam.attr_id LIKE '%\\\\_STATUS'\n" +
    "GROUP BY a ORDER BY a");
}
