// The correlates view's SQL: what its runner (run.ts) asks each participant's database for.
// correlates: one gene's expression against every gene's, genome-wide
import { pidOf } from "../../federation-views.ts";
import { finiteSql } from "../../sql-number.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per GENE, over the cohort's patients with a value for both it and the query gene (each the mean
 * of the patient's samples, as profileMomentsSql takes it): the six sums Pearson's r needs, n, Σx,
 * Σy, Σxy, Σx², Σy² — and the same six over the two values' average ranks among those patients,
 * which is Spearman's ρ. x is the query gene on `profileType`; y every gene on `otherProfile`
 * (the same profile unless given). Sums only: ranks and values never leave the database.
 */
export function correlatesMomentsSql(cohortSql: string, study: string, db: string, gene: string, profileType: string, otherProfile: string): AggregateSql {
  const pid = pidOf("sd.patient_unique_id", study);
  const raw = finiteSql("ga.alteration_value");
  const vals = (pt: string, geneCond: string) =>
    "  SELECT " + pid + " AS pid, ga.hugo_gene_symbol AS gene, avg(" + raw + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(pt) + geneCond + "\n" +
    "    AND " + raw + " IS NOT NULL AND isFinite(" + raw + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid, gene\n";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "q AS (\n" + vals(profileType, " AND ga.hugo_gene_symbol = " + sq(gene)) + "),\n" +
    "o AS (\n" + vals(otherProfile, "") + "),\n" +
    "paired AS (SELECT o.gene AS gene, q.v AS x, o.v AS y FROM o INNER JOIN q ON q.pid = o.pid),\n" +
    // average rank among tied values: the first rank of the tie plus half its width
    "ranked AS (\n" +
    "  SELECT gene, x, y,\n" +
    "         rank() OVER (PARTITION BY gene ORDER BY x) + (count() OVER (PARTITION BY gene, x) - 1) / 2 AS rx,\n" +
    "         rank() OVER (PARTITION BY gene ORDER BY y) + (count() OVER (PARTITION BY gene, y) - 1) / 2 AS ry\n" +
    "  FROM paired\n" +
    ")\n" +
    "SELECT gene, count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy,\n" +
    "       sum(rx) AS rsx, sum(ry) AS rsy, sum(rx * ry) AS rsxy, sum(rx * rx) AS rsxx, sum(ry * ry) AS rsyy\n" +
    "FROM ranked GROUP BY gene"
  ));
}
