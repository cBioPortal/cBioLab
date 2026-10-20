// The Results page's deployment settings: the study cap and cBioPortal's cross-study expression rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resultsMaxStudies, crossStudyExpression, expressionAcross, isExpressionProfile } from "../lib/results-settings.ts";

test("the study cap is 50 unless a positive whole number is set", () => {
  assert.equal(resultsMaxStudies({}), 50);
  assert.equal(resultsMaxStudies({ RESULTS_MAX_STUDIES: "12" }), 12);
  for (const bad of ["0", "-3", "2.5", "many"]) assert.equal(resultsMaxStudies({ RESULTS_MAX_STUDIES: bad }), 50, bad);
});

test("expression across studies follows cBioPortal: PanCancer Atlas only, by default", () => {
  const pancan = ["brca_tcga_pan_can_atlas_2018", "luad_tcga_pan_can_atlas_2018"];
  const mixed = ["brca_tcga_pan_can_atlas_2018", "coadread_tcga_pub"];
  assert.equal(crossStudyExpression({}), "pancan");
  assert.equal(expressionAcross(pancan, "pancan"), true);
  assert.equal(expressionAcross(mixed, "pancan"), false);
  assert.equal(expressionAcross(mixed, "all"), true);
  assert.equal(expressionAcross(pancan, "none"), false);
  assert.equal(expressionAcross(["coadread_tcga_pub"], "none"), true, "one study always may");
  assert.equal(crossStudyExpression({ CROSS_STUDY_EXPRESSION: "ALL" }), "all");
  assert.equal(crossStudyExpression({ CROSS_STUDY_EXPRESSION: "sometimes" }), "pancan");
});

test("expression profiles are mRNA, microRNA and protein; copy number and methylation are not", () => {
  for (const p of ["rna_seq_v2_mrna", "rna_seq_v2_mrna_median_Zscores", "mrna", "mirna", "rppa", "protein_quantification"]) assert.equal(isExpressionProfile(p), true, p);
  for (const p of ["gistic", "log2CNA", "methylation_hm450"]) assert.equal(isExpressionProfile(p), false, p);
});
