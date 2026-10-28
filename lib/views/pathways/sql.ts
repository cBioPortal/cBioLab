// The pathways view's SQL: what its runner (run.ts) asks each participant's database for.
// pathways: is ANY gene of a set altered?
import { sq } from "../../compiler.ts";
import { driverJoin, ALTERED_COND } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";

/**
 * Per gene SET, for one cohort in one study: the cohort's samples profiled for at least one member
 * (any alteration type), altered in at least one member, and carrying a driver in at least one
 * member — the oncoprint's merged-row rule, so a set's percentage is over the UNION of its
 * members' panels. Built from exactly the CTEs geneCountsSql uses (same event table, the same
 * high-level-CNA rule, the same driver join, the same panel coverage), so a one-gene set gives
 * that gene's own 'any' counts.
 */
export function geneSetCountsSql(cohortSql: string, sets: { name: string; genes: string[] }[], study: string,
  pin: string | null, db: string): AggregateSql {
  const genes = [...new Set(sets.flatMap((x) => x.genes))];
  const geneList = genes.map(sq).join(",");
  const pairs = sets.flatMap((x) => x.genes.map((g) => "(" + sq(x.name) + "," + sq(g) + ")")).join(",");
  const sid = bareSampleId("g.sample_unique_id", study), covSid = bareSampleId("sp.sample_unique_id", study);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "members AS (SELECT tupleElement(m, 1) AS set_name, tupleElement(m, 2) AS gene FROM (SELECT arrayJoin([" + pairs + "]) AS m)),\n" +
    "altered AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, " + sid + " AS sid,\n" +
    (pin ? "         max(ann.is_driver) AS is_driver\n" : "         0 AS is_driver\n") +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + inCohortSamples(sid) + "\n" +
    "  GROUP BY gene, sid\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covSid + " AS sid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND " + inCohortSamples(covSid) + "\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT members.set_name AS set_name, x.sid AS sid, max(x.is_alt) AS is_alt, max(x.is_drv) AS is_drv\n" +
    "  FROM (\n" +
    "    SELECT gene, sid, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered\n" +
    "    UNION ALL\n" +
    "    SELECT gene, sid, 0 AS is_alt, 0 AS is_drv FROM covered\n" +
    "  ) x\n" +
    "  INNER JOIN members ON members.gene = x.gene\n" +
    "  GROUP BY set_name, sid\n" +
    ")\n" +
    "SELECT set_name, uniqExact(sid) AS profiled, uniqExactIf(sid, is_alt = 1) AS altered, uniqExactIf(sid, is_drv = 1) AS driver\n" +
    "FROM per GROUP BY set_name"
  ));
}
