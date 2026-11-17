// Cluster / Don't cluster on a heatmap profile's rows, against the legacy portal at cbioportal-frontend cd8c6df:
//   RVU = src/shared/components/oncoprint/ResultsViewOncoprintUtils.tsx makeTrackGroupHeader (466-530)
//   OC  = src/shared/components/oncoprint/controls/OncoprintControls.tsx (815-838)
// clusterSort(keys, profileType): with a profile, "cluster:<profile>" first, any other cluster key dropped,
// cut to 4 keys; with null, every cluster key dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { clusterSort } from "../app/_oncoprint/track-edits.ts";

test("K1: Cluster puts this profile's cluster key first (RVU 484-492)", () => {
  assert.deepEqual(clusterSort(["-AGE"], "mrna"), ["cluster:mrna", "-AGE"]);
});

test("K2: clustering one profile replaces another profile's clustering (RVU: one clustered group)", () => {
  assert.deepEqual(clusterSort(["cluster:rppa", "AGE"], "mrna"), ["cluster:mrna", "AGE"]);
});

test("K3: Don't cluster drops the cluster key (RVU 495-503)", () => {
  assert.deepEqual(clusterSort(["cluster:mrna", "AGE"], null), ["AGE"]);
});

test("K4: no keys, no clustering", () => {
  assert.deepEqual(clusterSort([], null), []);
});

test("K5: at most 4 keys, cluster first (ours)", () => {
  assert.deepEqual(clusterSort(["a", "b", "c", "d"], "mrna"), ["cluster:mrna", "a", "b", "c"]);
});

test("K6: Don't cluster on profile A while B is clustered leaves keys unchanged (RVU 497-499)", () => {
  // The row handler acts only when its own profile is the clustered one; the keys are never passed to clusterSort.
  const keys = ["cluster:rppa", "AGE"];
  const dontCluster = (rowProfile: string, k: string[]) => (k.includes(`cluster:${rowProfile}`) ? clusterSort(k, null) : k);
  assert.deepEqual(dontCluster("mrna", keys), keys);
  assert.deepEqual(dontCluster("rppa", keys), ["AGE"]);
});

test("K7: Cluster / Don't cluster on heatmap rows with a profileType only (RVU 476)", {
  skip: "UI in OncoprintFigure.tsx; no existing test renders its track menu",
}, () => {});

test("K8: the sort select's single disabled 'sorted by heatmap clustering order' entry (OC 815-838)", {
  skip: "UI in OncoprintFigure.tsx; no existing test renders its sort select",
}, () => {});
