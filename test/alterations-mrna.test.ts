// The Patient mutation table's mRNA Expr. column (PAT-MT-5, PAT-STM-4): the profile it ranks in, when
// it is shown, its SQL, and its cell (lib/views/alterations/mrna-cell.ts), with numbers from cbioportal.org.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alterationDefaults, alterationSource, mrnaRankProfile } from "../lib/patient-alterations.ts";
import { mrnaDot, mrnaTooltip } from "../lib/views/alterations/mrna-cell.ts";
import { STYLE } from "../lib/oncoprint-style.ts";

const STUDY = "coadread_tcga_pan_can_atlas_2018";

test("PAT-STM-4: the profile is the first of the study's, in id order, matching /^.+rna_seq.*_zscores$/i (the portal's mrnaRankMolecularProfileId)", () => {
  const coadread = ["gistic", "rna_seq_v2_mrna", "rna_seq_v2_mrna_median_all_sample_Zscores", "rna_seq_v2_mrna_median_all_sample_ref_normal_Zscores",
    "rna_seq_v2_mrna_median_Zscores", "rppa_Zscores", "mutations"];
  assert.equal(mrnaRankProfile(STUDY, coadread), "rna_seq_v2_mrna_median_Zscores", "'Z' sorts before 'a', as the portal's list");
  assert.equal(mrnaRankProfile("s", ["mrna_U133_Zscores", "rna_seq_mrna", "rppa_Zscores"]), null, "a microarray or a non-z-score profile is not one");
  assert.equal(mrnaRankProfile("s", ["RNA_Seq_v2_mRNA_median_zscores"]), "RNA_Seq_v2_mRNA_median_zscores", "case-insensitive");
  assert.equal(mrnaRankProfile("s", []), null);
});

test("PAT-MT-5: mRNA Expr. is shown after Copy # with one sample in view and a profile to rank in, never otherwise", () => {
  assert.deepEqual(alterationDefaults("mutations", 1, true), ["gene", "proteinChange", "annotation", "mutationType", "vaf", "copy", "mrna", "freq"]);
  assert.ok(!alterationDefaults("mutations", 1, false).includes("mrna"), "no profile");
  assert.ok(!alterationDefaults("mutations", 1).includes("mrna"), "no profile, by default");
  assert.ok(!alterationDefaults("mutations", 2, true).includes("mrna"), "two samples in view");
  assert.ok(!alterationDefaults("cna", 1, true).includes("mrna"));
});

test("PAT-STM-4: the SQL ranks the sample's value among every sample's of the gene, ties at the highest, to 2 places half up; no profile, no column values", () => {
  const part = { cohort: "c", study: STUDY, cohortSql: "SELECT '' AS pid" };
  const sql = alterationSource("mutations", part, "TCGA-A6-2671", "db", null, [], "patient", undefined, { profile: "rna_seq_v2_mrna_median_Zscores", sample: "TCGA-A6-2671-01" }).with;
  assert.match(sql, /profile_type = 'rna_seq_v2_mrna_median_Zscores' AND hugo_gene_symbol IN \(SELECT gene FROM g\) AND z IS NOT NULL/);
  assert.match(sql, /if\(isFinite\(ifNull\(toFloat64OrNull\(alteration_value\), nan\)\), toFloat64OrNull\(alteration_value\), NULL\) AS z/, "NaN, ±Infinity and text are missing (finiteSql)");
  assert.match(sql, /toFloat64\(round\(toDecimal64\(100 \* countIf\(mv\.z <= me\.z\), 6\) \/ count\(\), 2\)\) AS pct/);
  assert.match(sql, /WHERE s = 'coadread_tcga_pan_can_atlas_2018_TCGA-A6-2671-01'/);
  assert.match(sql, /if\(mr\.gene != '', mr\.pct, NULL\) AS mrna, if\(mr\.gene != '', mr\.z, NULL\) AS mrnaZ/, "a gene with no value is NULL, not the join's 0");
  assert.match(sql, /LEFT JOIN mr ON mr\.gene = g\.gene/);
  const none = alterationSource("mutations", part, "TCGA-A6-2671", "db", null, []).with;
  assert.doesNotMatch(none, /genetic_alteration_derived/);
  assert.match(none, /CAST\(NULL AS Nullable\(Float64\)\) AS mrna/);
});

test("PAT-MT-5: the cell's dot sits between the line's ends at the percentile, blue below 25, red above 75 (TCGA-A6-2671: ABCG1 25.51, ABCA2 90.03)", () => {
  const abcg1 = mrnaDot(25.51), abca2 = mrnaDot(90.03);
  assert.equal(abcg1.fill, "gray"); assert.equal(abcg1.text, "26%");
  assert.equal(abca2.fill, "red"); assert.equal(abca2.text, "90%");
  assert.equal(mrnaDot(24.99).fill, "blue"); assert.equal(mrnaDot(25).fill, "gray"); assert.equal(mrnaDot(75).fill, "gray"); assert.equal(mrnaDot(75.01).fill, "red");
  assert.equal(mrnaDot(0).cx, 3); assert.equal(mrnaDot(100).cx, 27); assert.equal(mrnaDot(50).cx, 15);
  assert.deepEqual([abca2.width, abca2.height, abca2.textX, abca2.textY, abca2.lineY, abca2.r], [63, 12, 33, 11, 8, 3]);
  assert.equal(mrnaTooltip(90.03, 1.161), "mRNA level of the gene in this tumor\nmRNA z-score: 1.161\nPercentile: 90.03");
  assert.equal(mrnaTooltip(null, null), "mRNA data is not available for this gene.");
});

test("the cell's colours and sizes come from the style (invariant 8)", () => {
  const S = { ...STYLE, mrnaBar: { ...STYLE.mrnaBar, high: "#900", width: 50 } };
  assert.equal(mrnaDot(90, S).fill, "#900");
  assert.equal(mrnaDot(100, S).cx, 47);
});
