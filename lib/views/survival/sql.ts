// The survival view's own SQL: what its runner (run.ts) asks each participant's database for
// beyond the survival counts themselves.
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { sq } from "../../compiler.ts";
import { clinicalMetaTable, clinicalTable } from "../../custom-data.ts";
import { inCohortPatients } from "../../cohort2.ts";
import { survivalMonthsSql, survivalEventSql, endpointRowsSql, endpointValueSql } from "../../survival-sql.ts";

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
 * The cohorts' patients split by which of the cohorts each is in, as cBioPortal's Comparison page
 * draws survival in its Include mode: `mask` has bit i set for cohort i, so every patient falls in
 * exactly one mask. Per mask, the patients grouped by identical endpoint time and event, as
 * survivalCountsSql counts them; a patient without a usable time is a row with m NULL, so a mask's
 * rows add up to all its patients. Counts only: no patient id leaves.
 */
export function partitionSurvivalSql(cohortSqls: string[], study: string, db: string, endpoint: string): AggregateSql {
  if (cohortSqls.length < 2) throw new Error("partitionSurvivalSql needs at least two cohorts");
  if (cohortSqls.length > 30) throw new Error("partitionSurvivalSql takes at most 30 cohorts");
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const months = endpoint + "_MONTHS", status = endpoint + "_STATUS";
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const ctes = cohortSqls.map((c, i) => "c" + i + " AS (" + c + ")").join(",\n");
  const each = cohortSqls.map((_, i) => "SELECT pid FROM c" + i).join(" UNION ALL ");
  const mask = cohortSqls.map((_, i) => "(" + inCohortPatients("pid", "c" + i) + ") * " + (2 ** i)).join(" + ");
  return aggregateSql("WITH " + ctes + ",\n" +
    "cohort AS (SELECT DISTINCT pid FROM (" + each + ")),\n" +
    "pm AS (SELECT pid, toUInt32(" + mask + ") AS mask FROM cohort),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + endpointValueSql(months) + " AS months,\n" +
    "         " + endpointValueSql(status) + " AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + endpointRowsSql(months, status, "type='patient'") + "\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT pm.mask AS mask, " + survivalMonthsSql("os.months", "os.status") + " AS m, if(m IS NULL, 0, " + survivalEventSql("os.status") + ") AS ev, count() AS n\n" +
    "FROM pm LEFT JOIN os ON os.pid = pm.pid\n" +
    "GROUP BY mask, m, ev ORDER BY mask, m, ev");
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
