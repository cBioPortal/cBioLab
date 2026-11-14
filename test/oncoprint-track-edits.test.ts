import test from "node:test";
import assert from "node:assert/strict";
import { pruneSort, removeTrack, canRemoveTrack, withClinical, withGenes, withHeatmap, clinicalTrackRows, trackFreqText, selectAll, trackAttrs } from "../app/_oncoprint/track-edits.ts";

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

test("a clustered sort re-runs the view, other sort keys do not: only the engine can cluster", async () => {
  const { dataPart } = await import("../app/_oncoprint/view-data.ts");
  const v = { kind: "oncoprint", genes: ["KRAS"], heatmap: [{ profileType: "p" }] };
  assert.deepEqual(dataPart({ ...v, sort: ["AGE"] }), dataPart(v), "a clinical sort is drawn in the browser");
  assert.notDeepEqual(dataPart({ ...v, sort: ["cluster:p"] }), dataPart(v), "a cluster key changes what the engine is asked");
  assert.deepEqual(dataPart({ ...v, sort: ["cluster:p"], display: { whitespace: false } }), { ...v, cluster: ["cluster:p"] });
});

test("Select all (N) counts every listed row, adds only those with data, and is not offered once all are on (ONC-TR-1; FixedHeaderTable 368-380)", () => {
  const pct = (n: string) => ({ A: 50, B: 0, C: 20 } as Record<string, number>)[n];
  assert.deepEqual(selectAll(["A", "B", "C"], [], pct, 100), { n: 3, offered: true, next: ["A", "C"] }, "B at 0% counts but is not added");
  assert.equal(selectAll(["A", "C"], ["A", "C"], pct, 100).offered, false, "every listed row on");
  assert.equal(selectAll(["A", "B", "C"], ["A", "C"], pct, 100).offered, true, "the 0% row is not on, so the portal still offers it");
  assert.deepEqual(selectAll(["A", "C"], ["X"], pct, 2).next, ["X", "A"], "up to the cap");
});

test("the Tracks menu lists every declared attribute with its stored priority, 0 where the selection has none (ONC-TR-1; ResultsViewPageStore clinicalAttributes)", () => {
  const got = trackAttrs({
    clinical: [{ attribute: "CANCER_TYPE", kind: "cat", patients: 40, per: "sample", priority: 3000 }, { attribute: "X_UPLOAD", kind: "cat", patients: 2 }],
    declaredAttributes: [{ attribute: "CANCER_TYPE", per: "sample", displayName: "Cancer Type", priority: 1 }, { attribute: "PATIENT_FLAG", per: "patient", priority: 1 }]
  });
  assert.deepEqual(got.map((a) => [a.attribute, a.patients, a.priority ?? null]), [["CANCER_TYPE", 40, 1], ["PATIENT_FLAG", 0, 1], ["X_UPLOAD", 2, null]]);
  assert.equal(clinicalTrackRows(got, { patients: 40, samples: 44 }).find((r) => r.attribute === "PATIENT_FLAG")!.pct, 0);
});

test("the Tracks menu's ties are by name in code-unit order, as lodash sortBy (TracksMenu)", () => {
  const rows = clinicalTrackRows([{ attribute: "E", kind: "cat", patients: 1, displayName: "Éclair" }, { attribute: "Z", kind: "cat", patients: 1, displayName: "zeta" }],
    { patients: 1, samples: 1 });
  assert.deepEqual(rows.map((r) => r.label), ["zeta", "Éclair"]);
});
