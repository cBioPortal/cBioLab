// The cancertypes view's SQL: what its runner (run.ts) asks each participant's database for.
// cancertypes: a gene list's alteration frequency per group of samples
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { sq, genomicStudySql } from "../../compiler.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { clinicalTable } from "../../custom-data.ts";
import { driverJoin, ALTERED_COND } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { oqlEventsSql, parseOql, expressionProfileFor, type OqlPins, type OqlDriverOpts } from "../../oql.ts";
import { finiteSql } from "../../sql-number.ts";

/** the query's lines, one gene each: what is altered is what they match (the portal's OQL-filtered data) */
export interface CancertypesOql extends OqlDriverOpts { lines: string[]; profiles?: string[]; pins?: OqlPins }

/** each line's matches as (suid, gene, t), t the kind the portal counts it as */
function oqlAltSql(oql: CancertypesOql, study: string, db: string, pin: string | null): string {
  const kind = "multiIf(e.o = 1, 'mutation', e.o = 2 AND e.ev = 'AMP', 'amp', e.o = 2, 'homdel', e.o = 3, 'sv',\n" +
    "           e.ev = 'EXP HIGH', 'mrnaHigh', e.ev = 'EXP LOW', 'mrnaLow', e.ev = 'PROT HIGH', 'protHigh', 'protLow')";
  return oql.lines.map((line) => {
    const [{ gene }] = parseOql(line);
    return "  SELECT concat(" + sq(study + "_") + ", e.sid) AS suid, " + sq(gene) + " AS gene, " + kind + " AS t\n" +
      "  FROM (" + oqlEventsSql(line, { oncokbPin: pin, profiles: oql.profiles, pins: oql.pins, study, db, drivers: oql.drivers, hotspotPins: oql.hotspotPins }) + ") e\n" +
      "  WHERE concat(" + sq(study + "_") + ", e.sid) IN (SELECT suid FROM samp)";
  }).join("\n  UNION ALL\n");
}

/** the samples a line's EXP / PROT reads a value for: profiled for its gene, as a sample in a selected expression profile */
function oqlLevelCoverageSql(oql: CancertypesOql, study: string, db: string): string {
  const parts: string[] = [];
  for (const type of ["EXP", "PROT"] as const) {
    const genes = [...new Set(oql.lines.flatMap((l) => parseOql(l)).filter((e) => e.specs.some((x) => x.type === type)).map((e) => e.gene))];
    if (!genes.length) continue;
    const prof = expressionProfileFor(type, oql.profiles, oql.pins);
    parts.push("  SELECT DISTINCT ga.sample_unique_id AS suid, ga.hugo_gene_symbol AS gene FROM " + db + ".genetic_alteration_derived ga\n" +
      "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(prof) + " AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
      "    AND " + finiteSql("ga.alteration_value") + " IS NOT NULL AND ga.sample_unique_id IN (SELECT suid FROM samp)");
  }
  return parts.map((p) => "\n  UNION DISTINCT\n" + p).join("");
}

const PORTAL_CATEGORIES = new Set(["CANCER_TYPE", "CANCER_TYPE_DETAILED"]);

/**
 * Each cohort sample's group as (suid, g folded, label), over the query's `samp`: an attribute's value
 * (no row for a sample without one), or the study by its name. CANCER_TYPE and CANCER_TYPE_DETAILED read
 * as the portal's (ResultsViewPageStore extendSamplesWithCancerType): a sample without a cancer type
 * takes its study's type of cancer, else "Unknown", and one without a detailed type its cancer type.
 */
function groupSql(db: string, study: string, attribute: string | null): string {
  if (!attribute)
    return "SELECT suid, " + sq(study) + " AS g, (SELECT any(name) FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ") AS label FROM samp";
  if (!PORTAL_CATEGORIES.has(attribute))
    return "SELECT sample_unique_id AS suid, any(" + clinicalValueFoldSql("attribute_value") + ") AS g, any(attribute_value) AS label FROM " + clinicalTable(db, [attribute]) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
      "    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid";
  const studyType = "(SELECT ifNull(nullIf(any(t.name), ''), 'Unknown') FROM " + db + ".cancer_study cs JOIN " + db + ".type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id\n" +
    "     WHERE cs.cancer_study_identifier = " + sq(study) + ")";
  const ct = "if(ifNull(c.ct, '') != '', c.ct, " + studyType + ")";
  const detailed = attribute === "CANCER_TYPE_DETAILED";
  const read = detailed ? ["CANCER_TYPE", "CANCER_TYPE_DETAILED"] : ["CANCER_TYPE"];
  const value = detailed ? "if(ifNull(c.ctd, '') != '', c.ctd, " + ct + ")" : ct;
  return "SELECT suid, " + clinicalValueFoldSql("v") + " AS g, v AS label FROM (\n" +
    "  SELECT samp.suid AS suid, " + value + " AS v FROM samp LEFT JOIN (\n" +
    "    SELECT sample_unique_id AS suid, anyIf(attribute_value, attribute_name = 'CANCER_TYPE') AS ct" +
    (detailed ? ", anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS ctd" : "") + " FROM " + clinicalTable(db, read) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name IN (" + read.map(sq).join(", ") + ")\n" +
    "      AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
    "  ) c ON c.suid = samp.suid)";
}

/**
 * Per group of the cohort's samples (a sample attribute's value, or the study) and per gene — plus
 * the row "*" for the genes together — the units profiled for that gene and how many are altered,
 * split by kind: only mutations, only amplifications, only deep deletions, only structural variants,
 * or more than one kind. A unit is a SAMPLE of the cohort, or a PATIENT counted in each group one of
 * their in-cohort samples falls in (the portal's default); a patient is profiled when any of their
 * in-cohort samples is, and carries the union of those samples' alterations. Counts only.
 */
export function cancerTypesSql(cohortSql: string, study: string, db: string, genes: string[], attribute: string | null,
  pin: string | null, measure: "driver" | "any", unit: "sample" | "patient" = "sample", oql?: CancertypesOql): AggregateSql {
  const geneList = genes.map(sq).join(",");
  const drv = measure === "driver" && pin;
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    "),\n" +
    "grp AS (" + groupSql(db, study, attribute) + "),\n" +
    "alt AS (\n" +
    (oql ? oqlAltSql(oql, study, db, pin) + "\n),\n" : "") +
    (oql ? "" : "  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene,\n" +
    "         multiIf(g.variant_type = 'mutation', 'mutation', g.variant_type = 'cna' AND g.cna_alteration >= 2, 'amp',\n" +
    "                 g.variant_type = 'cna', 'homdel', 'sv') AS t\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (drv ? driverJoin(pin) : "") +
    "  WHERE " + genomicStudySql(study, "g") + " AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM samp)" + (drv ? " AND ann.is_driver" : "") + "\n" +
    "  GROUP BY suid, gene, t\n" +
    "),\n") +
    // a sample is profiled for a gene its panel lists
    "cov AS (\n" +
    "  SELECT DISTINCT sp.sample_unique_id AS suid, pg.gene AS gene FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.sample_unique_id IN (SELECT suid FROM samp)\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')" +
    (oql ? oqlLevelCoverageSql(oql, study, db) : "") + "\n" +
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
    "uu AS (SELECT k, g, label, gene, types FROM u UNION ALL SELECT k, g, label, gene, types FROM uall),\n" +
    // a unit's alterations are counted once per TYPE (the portal's uniqBy alterationType): an
    // amplification and a deep deletion are one copy-number kind, shown as the amplification
    "uk AS (SELECT grp_, gene, label, types, arrayDistinct(arrayMap((t) -> multiIf(t IN ('amp', 'homdel'), 'cna', t IN ('mrnaHigh', 'mrnaLow'), 'mrna',\n" +
    "         t IN ('protHigh', 'protLow'), 'prot', t), types)) AS kinds FROM (SELECT g AS grp_, gene, label, types FROM uu))\n" +
    "SELECT grp_ AS grp, gene, any(label) AS label, count() AS profiled,\n" +
    "       countIf(length(types) > 0) AS altered,\n" +
    "       countIf(kinds = ['mutation']) AS mutation, countIf(kinds = ['cna'] AND has(types, 'amp')) AS amp,\n" +
    "       countIf(kinds = ['cna'] AND NOT has(types, 'amp')) AS homdel, countIf(kinds = ['sv']) AS sv,\n" +
    "       countIf(kinds = ['mrna'] AND has(types, 'mrnaHigh')) AS mrnaHigh, countIf(kinds = ['mrna'] AND NOT has(types, 'mrnaHigh')) AS mrnaLow,\n" +
    "       countIf(kinds = ['prot'] AND has(types, 'protHigh')) AS protHigh, countIf(kinds = ['prot'] AND NOT has(types, 'protHigh')) AS protLow,\n" +
    "       countIf(length(kinds) > 1) AS multiple\n" +
    "FROM uk GROUP BY grp, gene"
  ));
}

/** Each group's units (the cohort's samples, or patients with one of them in the group), profiled or not, and how many
 *  were profiled for mutations, copy number and structural variants at all — the portal's "+" rows. */
export function cancerTypeSamplesSql(cohortSql: string, study: string, db: string, attribute: string | null, unit: "sample" | "patient" = "sample"): AggregateSql {
  const k = unit === "patient" ? "samp.puid" : "samp.suid";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
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
    (attribute ? "LEFT JOIN (" + groupSql(db, study, attribute) + ") grp ON grp.suid = samp.suid\n" : "") +
    "GROUP BY grp\n" +
    // the whole cohort, each unit once
    "UNION ALL SELECT '\\x01all' AS grp, uniqExact(" + k + "), uniqExactIf(" + k + ", has(prof.types, 'MUTATION_EXTENDED')),\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'COPY_NUMBER_ALTERATION')), uniqExactIf(" + k + ", has(prof.types, 'STRUCTURAL_VARIANT'))\n" +
    "FROM samp LEFT JOIN prof ON prof.suid = samp.suid"
  ));
}
