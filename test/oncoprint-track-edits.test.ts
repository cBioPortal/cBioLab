import test from "node:test";
import assert from "node:assert/strict";
import { pruneSort, removeTrack, canRemoveTrack, withClinical, withGenes, withHeatmap, clinicalTrackRows, trackFreqText } from "../app/_oncoprint/track-edits.ts";

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

test("Tracks › Clinical: the portal's Freq text and row order (ONC-TR-1, ONC-STM-4)", () => {
  assert.deepEqual([0, 0.04, 0.1, 37.25, 99.95, 100, null].map(trackFreqText), ["0%", "<0.1%", "0.1%", "37.3%", "99.9%", "100.0%", "NA"]);
  const rows = clinicalTrackRows([
    { attribute: "SEX", kind: "cat", patients: 10336, per: "patient", displayName: "Sex" },
    { attribute: "SAMPLE_TYPE", kind: "cat", patients: 10945, per: "sample", displayName: "Sample Type", priority: 1 },
    { attribute: "METASTATIC_SITE", kind: "cat", patients: 4779, per: "sample", displayName: "Metastatic Site" },
    { attribute: "ZERO", kind: "cat", patients: 0, per: "sample" }
  ], { patients: 10336, samples: 10945 });
  // msk_impact_2017: SAMPLE_TYPE on every sample, METASTATIC_SITE on 4,779 of 10,945 (the portal's count)
  assert.deepEqual(rows.map((r) => [r.label, trackFreqText(r.pct), r.unit]),
    [["Sample Type", "100.0%", "samples"], ["Sex", "100.0%", "patients"], ["Metastatic Site", "43.7%", "samples"], ["ZERO", "0%", "samples"]]);
});
