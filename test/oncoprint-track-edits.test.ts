import test from "node:test";
import assert from "node:assert/strict";
import { pruneSort, removeTrack, canRemoveTrack, withClinical, withGenes, withHeatmap } from "../app/_oncoprint/track-edits.ts";

const clustered = { genes: ["KRAS", "TP53"], clinical: ["AGE"], heatmap: [{ profileType: "mrna_zscore" }], sort: ["cluster:mrna_zscore", "AGE"] };

test("a cluster sort key survives track edits while its heatmap profile is on the view", () => {
  assert.deepEqual(pruneSort(clustered).sort, ["cluster:mrna_zscore", "AGE"]);
  assert.deepEqual(withClinical(clustered, ["AGE", "SEX"]).sort, ["cluster:mrna_zscore", "AGE"]);
  assert.deepEqual(withGenes(clustered, ["KRAS", "TP53", "BRAF"]).sort, ["cluster:mrna_zscore", "AGE"]);
  assert.deepEqual(removeTrack(clustered, "AGE").sort, ["cluster:mrna_zscore"]);
});

test("a cluster sort key goes with its heatmap profile", () => {
  assert.deepEqual(withHeatmap(clustered, []).sort, ["AGE"]);
  assert.deepEqual(withHeatmap(clustered, [{ profileType: "methylation" }]).sort, ["AGE"]);
});

test("Remove track is offered only where it changes the view", () => {
  assert.equal(canRemoveTrack({ genes: ["KRAS"] }, "KRAS"), false);
  assert.equal(canRemoveTrack({ genes: ["KRAS", "TP53"] }, "KRAS"), true);
  assert.equal(canRemoveTrack({ genes: ["KRAS"], clinical: ["AGE"] }, "AGE"), true);
  assert.equal(canRemoveTrack({ genes: ["KRAS"] }, "Study of origin"), false);
  assert.equal(canRemoveTrack({ genes: [{ genes: ["BRAF", "NRAS"] }] }, "BRAF / NRAS"), false);
});
