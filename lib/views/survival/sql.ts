// The survival view's own SQL: what its runner (run.ts) asks each participant's database for
// beyond the survival counts themselves.
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

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
