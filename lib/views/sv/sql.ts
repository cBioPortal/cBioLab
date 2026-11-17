// The sv view's aggregate SQL: what its runner (run.ts) asks each participant's database for beside
// the table's rows (lib/sv-table.ts), which only a patient-level participant pages.
import { sq } from "../../compiler.ts";
import { geneList } from "../../federation-views.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";

/**
 * Per queried gene, counts of the cohort's samples: all of them (`samples`); those profiled for
 * structural variants in the gene (`profiled`: the study's structural-variant panel for the sample
 * lists the gene, or is whole-exome — the same panel tables as the `profiled` clause); those with a
 * structural variant involving the gene as either partner (`altered`); and of those, the profiled
 * (`altered_profiled`) — a panel that omits a gene still reports a fusion when its partner is on
 * the panel. Counts only.
 */
export function svProfiledSql(cohortSql: string, study: string, db: string, genes: string[]): AggregateSql {
  const list = geneList(genes);
  return aggregateSql("WITH cohort AS (" + cohortSql + "),\n" +
    "cs AS (SELECT DISTINCT sid FROM cohort),\n" +
    "prof AS (\n" +
    "  SELECT DISTINCT " + bareSampleId("sp.sample_unique_id", study) + " AS sid, sp.gene_panel_id AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'STRUCTURAL_VARIANT'\n" +
    "    AND " + inCohortSamples(bareSampleId("sp.sample_unique_id", study), "cs") + "\n" +
    "),\n" +
    "pg AS (SELECT DISTINCT p.sid AS sid, g AS gene FROM prof p ARRAY JOIN [" + list + "] AS g\n" +
    "  WHERE p.panel = 'WES' OR (p.panel, g) IN (SELECT gene_panel_id, gene FROM " + db + ".gene_panel_to_gene_derived WHERE gene IN (" + list + "))),\n" +
    "alt AS (\n" +
    "  SELECT DISTINCT smp.stable_id AS sid, gn.hugo_gene_symbol AS gene\n" +
    "  FROM " + db + ".structural_variant sv\n" +
    "  ARRAY JOIN [sv.site1_entrez_gene_id, sv.site2_entrez_gene_id] AS eid\n" +
    "  JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id\n" +
    "  JOIN " + db + ".cancer_study st ON st.cancer_study_id = gp.cancer_study_id\n" +
    "  JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
    "  JOIN " + db + ".gene gn ON gn.entrez_gene_id = eid\n" +
    "  WHERE st.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'\n" +
    "    AND gn.hugo_gene_symbol IN (" + list + ") AND " + inCohortSamples("smp.stable_id", "cs") + "\n" +
    "),\n" +
    "marks AS (\n" +
    "  SELECT sid, gene, 'p' AS what FROM pg\n" +
    "  UNION ALL SELECT sid, gene, 'a' AS what FROM alt\n" +
    "  UNION ALL SELECT sid, gene, 'b' AS what FROM alt WHERE (sid, gene) IN (SELECT sid, gene FROM pg)\n" +
    ")\n" +
    "SELECT gene, any((SELECT count() FROM cs)) AS samples, uniqExactIf(sid, what = 'p') AS profiled,\n" +
    "       uniqExactIf(sid, what = 'a') AS altered, uniqExactIf(sid, what = 'b') AS altered_profiled\n" +
    "FROM marks GROUP BY gene ORDER BY gene");
}

/**
 * How many of the table's calls repeat a patient's call in another of their samples: the calls of
 * the cohort's samples with gene 1 or gene 2 among `genes` (each once), less the distinct (patient,
 * site 1 chromosome and position, site 2 chromosome and position) among them — the portal's
 * duplicateStructuralVariantCountInMultipleSamples (ResultsViewStructuralVariantMapperDataStore
 * 34-50), a missing value read as "". One row, `duplicates`. Counts only.
 */
export function svDuplicatesSql(cohortSql: string, study: string, db: string, genes: string[]): AggregateSql {
  const list = geneList(genes);
  const k = (c: string) => "ifNull(toString(" + c + "), '')";
  return aggregateSql("WITH cohort AS (" + cohortSql + "),\n" +
    "cs AS (SELECT DISTINCT sid FROM cohort),\n" +
    "ids AS (SELECT entrez_gene_id FROM " + db + ".gene WHERE hugo_gene_symbol IN (" + list + "))\n" +
    "SELECT count() - uniqExact(" + ["pt.stable_id", "sv.site1_chromosome", "sv.site1_position", "sv.site2_chromosome", "sv.site2_position"].map(k).join(", ") + ") AS duplicates\n" +
    "FROM " + db + ".structural_variant sv\n" +
    "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id\n" +
    "JOIN " + db + ".cancer_study st ON st.cancer_study_id = gp.cancer_study_id\n" +
    "JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
    "JOIN " + db + ".patient pt ON pt.internal_id = smp.patient_id\n" +
    "WHERE st.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'\n" +
    "  AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM ids) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM ids))\n" +
    "  AND " + inCohortSamples("smp.stable_id", "cs"));
}
