// The cancertypes view's SQL: what its runner (run.ts) asks each participant's database for.
// cancertypes: a gene list's alteration frequency per group of samples
import { pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { clinicalTable } from "../../custom-data.ts";
import { driverJoin, ALTERED_COND } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per group of the cohort's samples (a sample attribute's value, or the study) and per gene — plus
 * the row "*" for the genes together — the units profiled for that gene and how many are altered,
 * split by kind: only mutations, only amplifications, only deep deletions, only structural variants,
 * or more than one kind. A unit is a SAMPLE, or a PATIENT counted in each group one of their
 * samples falls in (the portal's default); a patient is profiled when any of their samples is, and
 * carries the union of their samples' alterations. Counts only.
 */
export function cancerTypesSql(cohortSql: string, study: string, db: string, genes: string[], attribute: string | null,
  pin: string | null, measure: "driver" | "any", unit: "sample" | "patient" = "sample"): AggregateSql {
  const geneList = genes.map(sq).join(",");
  const drv = measure === "driver" && pin;
  const fold = clinicalValueFoldSql("attribute_value");
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (attribute
      ? "grp AS (\n" +
        "  SELECT sample_unique_id AS suid, any(" + fold + ") AS g, any(attribute_value) AS label FROM " + clinicalTable(db, [attribute]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
        "    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
        "),\n"
      : "grp AS (SELECT suid, " + sq(study) + " AS g, " + sq(study) + " AS label FROM samp),\n") +
    "alt AS (\n" +
    "  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene,\n" +
    "         multiIf(g.variant_type = 'mutation', 'mutation', g.variant_type = 'cna' AND g.cna_alteration >= 2, 'amp',\n" +
    "                 g.variant_type = 'cna', 'homdel', 'sv') AS t\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (drv ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM samp)" + (drv ? " AND ann.is_driver" : "") + "\n" +
    "  GROUP BY suid, gene, t\n" +
    "),\n" +
    // a sample is profiled for a gene its panel lists, and for one it is altered in (an off-panel call is a measurement)
    "cov AS (\n" +
    "  SELECT DISTINCT sp.sample_unique_id AS suid, pg.gene AS gene FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.sample_unique_id IN (SELECT suid FROM samp)\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "  UNION DISTINCT SELECT DISTINCT suid, gene FROM alt\n" +
    "),\n" +
    "sg AS (\n" +
    "  SELECT cov.suid AS suid, cov.gene AS gene, groupUniqArrayIf(alt.t, alt.t != '') AS types\n" +
    "  FROM cov LEFT JOIN alt ON alt.suid = cov.suid AND alt.gene = cov.gene GROUP BY suid, gene\n" +
    "),\n" +
    "sg2 AS (SELECT suid, gene, types FROM sg UNION ALL SELECT suid, '*' AS gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM sg GROUP BY suid),\n" +
    "u AS (\n" +
    "  SELECT " + (unit === "patient" ? "samp.puid" : "sg2.suid") + " AS k, ifNull(grp.g, '') AS g, any(ifNull(grp.label, '')) AS label, sg2.gene AS gene,\n" +
    "         arrayDistinct(arrayFlatten(groupArray(sg2.types))) AS types\n" +
    "  FROM sg2 JOIN samp ON samp.suid = sg2.suid LEFT JOIN grp ON grp.suid = sg2.suid\n" +
    "  GROUP BY k, g, gene\n" +
    "),\n" +
    // the whole cohort, each unit once however many groups it is in: grp '' is reserved for it below
    "uall AS (SELECT k, '\\x01all' AS g, '' AS label, gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM u GROUP BY k, gene),\n" +
    "uu AS (SELECT k, g, label, gene, types FROM u UNION ALL SELECT k, g, label, gene, types FROM uall)\n" +
    "SELECT g AS grp, gene, any(label) AS label, count() AS profiled,\n" +
    "       countIf(length(types) > 0) AS altered,\n" +
    "       countIf(types = ['mutation']) AS mutation, countIf(types = ['amp']) AS amp,\n" +
    "       countIf(types = ['homdel']) AS homdel, countIf(types = ['sv']) AS sv,\n" +
    "       countIf(length(types) > 1) AS multiple\n" +
    "FROM uu GROUP BY grp, gene"
  ));
}

/** Each group's units (samples, or patients with a sample in the group), profiled or not, and how many
 *  were profiled for mutations, copy number and structural variants at all — the portal's "+" rows. */
export function cancerTypeSamplesSql(cohortSql: string, study: string, db: string, attribute: string | null, unit: "sample" | "patient" = "sample"): AggregateSql {
  const fold = clinicalValueFoldSql("attribute_value");
  const k = unit === "patient" ? "samp.puid" : "samp.suid";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "prof AS (\n" +
    "  SELECT sample_unique_id AS suid, groupUniqArray(alteration_type) AS types FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
    ")\n" +
    "SELECT " + (attribute ? "ifNull(grp.g, '')" : sq(study)) + " AS grp, uniqExact(" + k + ") AS samples,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'MUTATION_EXTENDED')) AS mut,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'COPY_NUMBER_ALTERATION')) AS cna,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'STRUCTURAL_VARIANT')) AS sv\n" +
    "FROM samp LEFT JOIN prof ON prof.suid = samp.suid\n" +
    (attribute
      ? "LEFT JOIN (\n" +
        "  SELECT sample_unique_id AS suid, any(" + fold + ") AS g FROM " + clinicalTable(db, [attribute]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
        "    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
        ") grp ON grp.suid = samp.suid\n"
      : "") +
    "GROUP BY grp\n" +
    // the whole cohort, each unit once
    "UNION ALL SELECT '\\x01all' AS grp, uniqExact(" + k + "), uniqExactIf(" + k + ", has(prof.types, 'MUTATION_EXTENDED')),\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'COPY_NUMBER_ALTERATION')), uniqExactIf(" + k + ", has(prof.types, 'STRUCTURAL_VARIANT'))\n" +
    "FROM samp LEFT JOIN prof ON prof.suid = samp.suid"
  ));
}
