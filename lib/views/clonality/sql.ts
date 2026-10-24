// The clonality view's SQL: what its runner (run.ts) asks each participant's database for.
import { pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { clinicalTable } from "../../custom-data.ts";
import { finiteSql } from "../../sql-number.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per gene, over the cohort's mutation CALLS that carry a FACETS estimate (a call is one mutation
 * in one sample): how many are clonal, subclonal, indeterminate or uncalled; how many sit in a
 * region with no minor allele (LOH at the locus), of those where the minor copy number is
 * known; and the cancer-cell fraction in ten bins. Only the study's current mutation profile is
 * read — the table also holds orphaned rows from superseded loads.
 */
export function clonalityGenesSql(cohortSql: string, study: string, db: string, genes: string[], pin: string | null,
  measure: "driver" | "any", qc: boolean): AggregateSql {
  const geneList = genes.map(sq).join(",");
  const drv = measure === "driver" && pin;
  return aggregateSql((
    facetsSamplesCte(cohortSql, study, db, qc) + ",\n" +
    "prof AS (\n" +
    "  SELECT gp.genetic_profile_id AS id FROM " + db + ".genetic_profile gp\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'\n" +
    "),\n" +
    "calls AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, a.sample_id AS sid, a.clonal AS call_state, a.ccf_expected_copies AS ccf, a.minor_copy_number AS minor\n" +
    "  FROM " + db + ".allele_specific_copy_number a\n" +
    "  JOIN " + db + ".mutation_event me ON me.mutation_event_id = a.mutation_event_id\n" +
    "  JOIN " + db + ".gene g ON g.entrez_gene_id = me.entrez_gene_id\n" +
    (drv
      ? "  INNER JOIN oncokb_annotation.variant_annotation ann ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
        "    AND ann.hugo_gene_symbol = g.hugo_gene_symbol AND ann.alteration_type = 'MUTATION' AND ann.alteration = me.protein_change\n"
      : "") +
    "  WHERE a.genetic_profile_id IN (SELECT id FROM prof) AND a.sample_id IN (SELECT sid FROM samp)\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ")\n" +
    ")\n" +
    "SELECT gene, count() AS calls, uniqExact(sid) AS samples,\n" +
    "       countIf(call_state = 'CLONAL') AS clonal, countIf(call_state = 'SUBCLONAL') AS subclonal,\n" +
    "       countIf(call_state = 'INDETERMINATE') AS indeterminate,\n" +
    "       countIf(minor = 0) AS loh, countIf(minor IS NOT NULL) AS loh_known,\n" +
    Array.from({ length: 10 }, (_, i) =>
      "       countIf(ccf >= " + (i / 10) + (i === 9 ? "" : " AND ccf < " + ((i + 1) / 10)) + ") AS ccf" + i).join(",\n") + "\n" +
    "FROM calls GROUP BY gene"
  ));
}

/**
 * Per cohort: its samples, how many carry any FACETS estimate, FACETS_QC pass/fail over ALL of
 * them, and whole-genome doubling among the samples considered (QC-passing ones, with `qc`).
 */
export function facetsSummarySql(cohortSql: string, study: string, db: string, qc: boolean): AggregateSql {
  const attr = (name: string) => "(SELECT sample_unique_id AS suid, " + clinicalValueFoldSql("attribute_value") + " AS v FROM " + clinicalTable(db, [name]) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(name) + ")";
  const considered = qc ? " AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')" : "";
  return aggregateSql((
    facetsSamplesCte(cohortSql, study, db, false) + ",\n" +
    "prof AS (\n" +
    "  SELECT gp.genetic_profile_id AS id FROM " + db + ".genetic_profile gp\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'\n" +
    "),\n" +
    "wgd AS " + attr("FACETS_WGD") + ",\n" +
    "qcv AS " + attr("FACETS_QC") + "\n" +
    "SELECT count() AS samples,\n" +
    "       countIf(sid IN (SELECT DISTINCT sample_id FROM " + db + ".allele_specific_copy_number WHERE genetic_profile_id IN (SELECT id FROM prof))) AS ascn_samples,\n" +
    "       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS qc_pass,\n" +
    "       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'fail')) AS qc_fail,\n" +
    "       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'true')" + considered + ") AS wgd_true,\n" +
    "       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'false')" + considered + ") AS wgd_false\n" +
    "FROM samp"
  ));
}

/** FACETS purity (0.05 bins over 0-1) and ploidy (0.25 bins over 0-8) among the samples considered. */
export function facetsHistogramSql(cohortSql: string, study: string, db: string, qc: boolean): AggregateSql {
  return aggregateSql((
    facetsSamplesCte(cohortSql, study, db, qc) + "\n" +
    "SELECT attribute_name AS attr,\n" +
    "       toInt32(floor(least(if(attribute_name = 'FACETS_PURITY', 0.9999, 7.9999), greatest(0, " + finiteSql("attribute_value") + ")) /\n" +
    "         if(attribute_name = 'FACETS_PURITY', 0.05, 0.25))) AS bin,\n" +
    "       count() AS n\n" +
    "FROM " + clinicalTable(db, ["FACETS_PURITY", "FACETS_PLOIDY"]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name IN ('FACETS_PURITY', 'FACETS_PLOIDY')\n" +
    "  AND sample_unique_id IN (SELECT suid FROM samp) AND " + finiteSql("attribute_value") + " IS NOT NULL\n" +
    "GROUP BY attr, bin ORDER BY attr, bin"
  ));
}

// ---------------------------------------------------------------------------
// clonality: FACETS allele-specific copy number, per mutation call

/** The cohort's samples; with `qc`, only those whose FACETS_QC is Pass. */
function facetsSamplesCte(cohortSql: string, study: string, db: string, qc: boolean): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid, sample_unique_id AS suid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    (qc
      ? "    AND sample_unique_id IN (SELECT sample_unique_id FROM " + clinicalTable(db, ["FACETS_QC"]) + "\n" +
        "      WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = 'FACETS_QC'\n" +
        "        AND " + clinicalValueFoldSql("attribute_value") + " = 'pass')\n"
      : "") +
    ")"
  );
}
