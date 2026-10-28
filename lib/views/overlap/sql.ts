// The overlap view's SQL: what its runner (run.ts) asks each participant's database for.
// overlap: how several cohorts' samples, and their patients, intersect
import { inCohortPatients, inCohortSamples } from "../../cohort2.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per membership pattern — a bitmask, bit i set when the member is in cohort i — how many of the
 * study's patients (n) and, separately, how many of its samples (samples) in any of the cohorts have
 * exactly that pattern. A sample's pattern is the cohorts that hold it; a patient's, the cohorts
 * that hold any of its samples, so a patient can share a pattern none of its samples has. 2^k − 1
 * rows at most, counts only; the caller names each bit.
 */
export function overlapCountsSql(cohortSqls: string[]): AggregateSql {
  if (!cohortSqls.length) throw new Error("overlapCountsSql needs at least one cohort");
  const ctes = cohortSqls.map((c, i) => "c" + i + " AS (" + c + ")").join(",\n");
  const union = cohortSqls.map((_, i) => "SELECT pid, sid FROM c" + i).join(" UNION DISTINCT ");
  const pMask = cohortSqls.map((_, i) => "(" + inCohortPatients("pid", "c" + i) + ") * " + (1 << i)).join(" + ");
  const sMask = cohortSqls.map((_, i) => "(" + inCohortSamples("sid", "c" + i) + ") * " + (1 << i)).join(" + ");
  return aggregateSql("WITH " + ctes + ",\nu AS (" + union + "),\n" +
    "pm AS (SELECT pid, " + pMask + " AS mask FROM (SELECT DISTINCT pid FROM u)),\n" +
    "sm AS (SELECT sid, " + sMask + " AS mask FROM (SELECT DISTINCT sid FROM u))\n" +
    "SELECT mask, sum(np) AS n, sum(ns) AS samples FROM (\n" +
    "  SELECT mask, count() AS np, toUInt64(0) AS ns FROM pm GROUP BY mask\n" +
    "  UNION ALL\n" +
    "  SELECT mask, toUInt64(0) AS np, count() AS ns FROM sm GROUP BY mask\n" +
    ") GROUP BY mask ORDER BY n DESC, samples DESC");
}
