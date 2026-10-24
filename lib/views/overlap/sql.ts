// The overlap view's SQL: what its runner (run.ts) asks each participant's database for.
// overlap: how several cohorts' patients intersect
import { pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per membership pattern — a bitmask, bit i set when the patient is in cohort i — how many of the
 * study's patients in any of the cohorts have exactly that pattern. 2^k − 1 counts at most, and
 * nothing else; the caller names each bit.
 */
export function overlapCountsSql(cohortSqls: string[], study: string, db: string): AggregateSql {
  if (!cohortSqls.length) throw new Error("overlapCountsSql needs at least one cohort");
  const ctes = cohortSqls.map((c, i) => "c" + i + " AS (" + c + ")").join(",\n");
  const union = cohortSqls.map((_, i) => "SELECT pid FROM c" + i).join(" UNION DISTINCT ");
  const mask = cohortSqls.map((_, i) => "(pid IN (SELECT pid FROM c" + i + ")) * " + (1 << i)).join(" + ");
  // each patient's samples ride along, so the same patterns are counted in samples too
  return aggregateSql("WITH " + ctes + ",\nu AS (" + union + "),\nm AS (SELECT pid, " + mask + " AS mask FROM u),\n" +
    "s AS (SELECT " + pidOf("patient_unique_id", study) + " AS pid, count() AS ns FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM u) GROUP BY pid)\n" +
    "SELECT mask, count() AS n, sum(s.ns) AS samples FROM m LEFT JOIN s ON s.pid = m.pid GROUP BY mask ORDER BY n DESC");
}
