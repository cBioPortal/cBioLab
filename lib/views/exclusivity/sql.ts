// The exclusivity view's SQL: what its runner (run.ts) asks each participant's database for.
import { sq } from "../../compiler.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { driverJoin, ALTERED_COND } from "../../federation.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { clinicalTable } from "../../custom-data.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * The samples grouped by what their background probability depends on — panel signature,
 * stratum and burden r (altered covered genes) — and by which of `genes` they have altered (a
 * bitmask, bit i for genes[i]): counts only.
 */
export function exclusivityGroupsSql(cohortSql: string, study: string, db: string, genes: string[], stratifyBy: string | null,
  pin: string | null, measure: "driver" | "any"): AggregateSql {
  const mask = genes.map((g, i) => "maxIf(" + (2 ** i) + ", altc.gene = " + sq(g) + ")").join(" + ") || "0";
  return aggregateSql((
    exclusivityCtes(cohortSql, study, db, stratifyBy, pin, measure) + ",\n" +
    "per AS (SELECT suid, count() AS r, " + mask + " AS amask FROM altc GROUP BY suid)\n" +
    "SELECT sp.sig AS sig, ifNull(strat.v, '') AS stratum, per.r AS r, per.amask AS amask, count() AS n\n" +
    "FROM sp LEFT JOIN per ON per.suid = sp.suid LEFT JOIN strat ON strat.suid = sp.suid\n" +
    "GROUP BY sig, stratum, r, amask"
  ));
}

/** Per stratum and gene, the samples with that gene altered (the background's column sums). */
export function exclusivityColumnsSql(cohortSql: string, study: string, db: string, stratifyBy: string | null, pin: string | null, measure: "driver" | "any"): AggregateSql {
  return aggregateSql((
    exclusivityCtes(cohortSql, study, db, stratifyBy, pin, measure) + "\n" +
    "SELECT ifNull(strat.v, '') AS stratum, altc.gene AS gene, count() AS n\n" +
    "FROM altc LEFT JOIN strat ON strat.suid = altc.suid GROUP BY stratum, gene"
  ));
}

/** The genes each panel signature in the cohort covers. Metadata only. */
export function exclusivityCoverageSql(cohortSql: string, study: string, db: string): AggregateSql {
  return aggregateSql(exclusivityCtes(cohortSql, study, db, null, null, "any") + "\nSELECT sig, gene FROM cov");
}

// ---------------------------------------------------------------------------
// exclusivity: the sample-by-gene alteration matrix, reduced to what DISCOVER's background needs

/**
 * The cohort's samples with a gene panel, each with its panel signature (every panel it was
 * profiled on, any alteration type, joined), its stratum (a sample attribute's folded value, or
 * '' unstratified), and its altered genes among those its panels cover (any alteration, or OncoKB
 * drivers): `sp`, `altc` and `strat` CTEs.
 */
function exclusivityCtes(cohortSql: string, study: string, db: string, stratifyBy: string | null, pin: string | null, measure: "driver" | "any"): string {
  const driver = measure === "driver";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "sp AS (\n" +
    "  SELECT sample_unique_id AS suid, arrayStringConcat(arraySort(groupUniqArray(gene_panel_id)), '+') AS sig\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    "  GROUP BY suid\n" +
    "),\n" +
    "cov AS (\n" +
    "  SELECT DISTINCT s.sig AS sig, pg.gene AS gene\n" +
    "  FROM (SELECT DISTINCT sig, arrayJoin(splitByChar('+', sig)) AS panel FROM sp) s\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = s.panel\n" +
    "),\n" +
    "altc AS (\n" +
    "  SELECT DISTINCT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driver && pin ? driverJoin(pin) : "") +
    "  INNER JOIN sp ON sp.suid = g.sample_unique_id\n" +
    "  INNER JOIN cov ON cov.sig = sp.sig AND cov.gene = g.hugo_gene_symbol\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND " + ALTERED_COND + (driver ? (pin ? " AND ann.is_driver" : " AND 0") : "") + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sp)\n" +
    "),\n" +
    "strat AS (\n" +
    (stratifyBy
      ? "  SELECT sample_unique_id AS suid, any(" + clinicalValueFoldSql("attribute_value") + ") AS v FROM " + clinicalTable(db, [stratifyBy]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(stratifyBy) + " AND sample_unique_id IN (SELECT suid FROM sp)\n" +
        "  GROUP BY suid\n"
      : "  SELECT suid, '' AS v FROM sp\n") +
    ")"
  );
}
