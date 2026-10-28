// The correlates view's SQL: what its runner (run.ts) asks each participant's database for.
// correlates: one gene's expression against every gene's, genome-wide
import { finiteSql } from "../../sql-number.ts";
import { sq } from "../../compiler.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per GENE, over the cohort's samples with a value for both it and the query gene, paired per
 * sample as cBioPortal's co-expression tab pairs them (a patient-level assay's value is paired with
 * each of its patient's samples in the cohort): the six sums Pearson's r needs, n, Σx,
 * Σy, Σxy, Σx², Σy² — and the same six over the two values' average ranks among those samples,
 * which is Spearman's ρ. x is the query gene on `profileType`; y every gene on `otherProfile`
 * (the same profile unless given). Sums only: ranks and values never leave the database.
 */
export function correlatesMomentsSql(cohortSql: string, study: string, db: string, gene: string, profileType: string, otherProfile: string, otherIsAssay = false): AggregateSql {
  const sid = bareSampleId("ga.sample_unique_id", study);
  // a generic-assay profile's entities in place of genes: a sample's own value, or its patient's for a
  // patient-level profile
  const assayRaw = finiteSql("a.value");
  const assayVals = (pt: string) =>
    "  SELECT c.sid AS sid, a.entity_stable_id AS gene, avg(" + assayRaw + ") AS v\n" +
    "  FROM " + db + ".generic_assay_data_derived a\n" +
    "  INNER JOIN cohort c ON c.sid = " + bareSampleId("a.sample_unique_id", study) + "\n" +
    "  WHERE a.profile_type = " + sq(pt) + " AND a.profile_stable_id = " + sq(study + "_" + pt) + "\n" +
    "    AND ifNull(a.patient_level, 0) = 0 AND " + assayRaw + " IS NOT NULL\n" +
    "  GROUP BY sid, gene\n" +
    "  UNION ALL\n" +
    "  SELECT c.sid AS sid, a.entity_stable_id AS gene, avg(" + assayRaw + ") AS v\n" +
    "  FROM " + db + ".generic_assay_data_derived a\n" +
    "  INNER JOIN cohort c ON c.pid = " + bareSampleId("a.patient_unique_id", study) + "\n" +
    "  WHERE a.profile_type = " + sq(pt) + " AND a.profile_stable_id = " + sq(study + "_" + pt) + "\n" +
    "    AND a.patient_level = 1 AND " + assayRaw + " IS NOT NULL\n" +
    "  GROUP BY sid, gene\n";
  const raw = finiteSql("ga.alteration_value");
  const vals = (pt: string, geneCond: string) =>
    "  SELECT " + sid + " AS sid, ga.hugo_gene_symbol AS gene, avg(" + raw + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(pt) + geneCond + "\n" +
    "    AND " + raw + " IS NOT NULL AND isFinite(" + raw + ")\n" +
    "    AND " + inCohortSamples(sid) + "\n" +
    "  GROUP BY sid, gene\n";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "q AS (\n" + vals(profileType, " AND ga.hugo_gene_symbol = " + sq(gene)) + "),\n" +
    "o AS (\n" + (otherIsAssay ? assayVals(otherProfile) : vals(otherProfile, "")) + "),\n" +
    "paired AS (SELECT o.gene AS gene, q.v AS x, o.v AS y FROM o INNER JOIN q ON q.sid = o.sid),\n" +
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
