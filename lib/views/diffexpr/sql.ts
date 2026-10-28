// The diffexpr view's SQL: what its runner (run.ts) asks each participant's database for.
// diffexpr: every gene's moments on one molecular profile
import { finiteSql } from "../../sql-number.ts";
import { sq } from "../../compiler.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Per GENE, over the cohort's samples: n, Σv and Σv² of each sample's value, as cBioPortal's group
 * comparison tests expression, on the profile as stored or as log2(v + 1). Three
 * additive totals per gene are all Welch's t needs, so a site sends no value at all, and every
 * gene in the profile comes back — a ranking for enrichment needs the whole list, not a
 * shortlist. A negative stored value under log2 has no meaning and is left out, never clamped.
 */
export function profileMomentsAllSql(cohortSql: string, study: string, db: string, profileType: string, log2: boolean): AggregateSql {
  const sid = bareSampleId("ga.sample_unique_id", study);
  const raw = finiteSql("ga.alteration_value");
  const val = log2 ? "log2(" + raw + " + 1)" : raw;
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "vals AS (\n" +
    "  SELECT " + sid + " AS sid, ga.hugo_gene_symbol AS gene, avg(" + val + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "    AND " + raw + " IS NOT NULL AND isFinite(" + raw + ")" + (log2 ? " AND " + raw + " >= 0" : "") + "\n" +
    "    AND " + inCohortSamples(sid) + "\n" +
    "  GROUP BY sid, gene\n" +
    ")\n" +
    "SELECT gene, count() AS n, sum(v) AS sx, sum(v * v) AS sxx FROM vals GROUP BY gene"
  ));
}

/** Named MSigDB gene sets and their members' symbols (`prefix` a set-name prefix, e.g. HALLMARK_). */
export function genesetMembersSql(names: string[], prefix: string | null, db: string): AggregateSql {
  const cond = names.length
    ? "gs.external_id IN (" + names.map(sq).join(",") + ")"
    : "startsWith(gs.external_id, " + sq(prefix || "HALLMARK_") + ")";
  return aggregateSql("SELECT gs.external_id AS set_name, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "FROM " + db + ".geneset gs\n" +
    "JOIN " + db + ".geneset_gene gg ON gg.geneset_id = gs.id\n" +
    "JOIN " + db + ".gene g ON g.entrez_gene_id = gg.entrez_gene_id\n" +
    "WHERE " + cond + " GROUP BY set_name ORDER BY set_name");
}
