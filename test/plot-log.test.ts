// cBioPortal's Plots tab log scales (lib/plot-log.ts): the transforms and their inverses
// (PlotsTabUtils.tsx makeAxisLogScaleFunction, PLT-STM-11), and which axis keeps its log scale
// over values below 0 (logScalePossibleForProfile, PLT-AX-4).
import test from "node:test";
import assert from "node:assert/strict";
import { fromLog, logRuleOf, logScaleExempt, toLog, LOG_SUFFIX } from "../lib/plot-log.ts";

test("the portal's log transforms and their inverses (PLT-STM-11)", () => {
  assert.equal(logRuleOf({ source: "clinical", attribute: "A" }), undefined);
  assert.equal(logRuleOf({ source: "clinical", attribute: "A", log: true }), "log2");
  assert.equal(logRuleOf({ source: "assay", profileType: "p", entity: "e", log: true }), "log10");
  // log2(max(x, 0) + 1): a negative is drawn at 0
  assert.deepEqual([-3, 0, 1, 3, 1023].map((x) => toLog("log2", x)), [0, 0, 1, 2, 10]);
  // log10(x), 0 read as 0
  assert.deepEqual([0, 1, 100, 0.01].map((x) => toLog("log10", x)), [0, 0, 2, -2]);
  assert.equal(fromLog("log2", 10), 1023);
  assert.equal(fromLog("log10", 2), 100);
});

test("an axis keeps its log scale with values below 0 only for an RNA-seq profile, not a z-score (logScalePossibleForProfile)", () => {
  assert.equal(logScaleExempt({ source: "molecular", profileType: "rna_seq_v2_mrna", gene: "KRAS", log: true }), true);
  assert.equal(logScaleExempt({ source: "profile", profile: "rna_seq_mrna", gene: "KRAS", log: true }), true);
  assert.equal(logScaleExempt({ source: "molecular", profileType: "rna_seq_v2_mrna_median_all_sample_Zscores", gene: "KRAS", log: true }), false);
  assert.equal(logScaleExempt({ source: "molecular", profileType: "linear_CNA", gene: "KRAS", log: true }), false);
  assert.equal(logScaleExempt({ source: "clinical", attribute: "AGE", log: true }), false);
});

test("a log axis's title ends as the portal's", () => {
  assert.deepEqual(LOG_SUFFIX, { log2: " (log2(value + 1))", log10: " (log10)" });
});
