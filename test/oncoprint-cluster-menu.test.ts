// Cluster / Don't cluster on a heatmap profile's rows and track sorting, against the legacy portal at cbioportal-frontend cd8c6df:
//   RVU = src/shared/components/oncoprint/ResultsViewOncoprintUtils.tsx makeTrackGroupHeader (466-530)
//   RVO = ResultsViewOncoprint.tsx sortByData (1302-1307), onTrackSortDirectionChange (1712-1719)
// One sort mode at a time: clustered by one profile, or sorted by data. Our sort is a list of at most 4 keys;
// "cluster:<profile>" clusters, "<label>" / "-<label>" sort a track a-Z / Z-a.
import test from "node:test";
import assert from "node:assert/strict";
import { clusteredProfile, clusterSort, selectSort, trackSort } from "../app/_oncoprint/track-edits.ts";

test("K1: Cluster puts this profile's cluster key first (RVU 466-530)", () => {
  assert.deepEqual(clusterSort(["-AGE"], "mrna", true), ["cluster:mrna", "-AGE"]);
});

test("K2: clustering one profile replaces another profile's clustering (RVU 466-530)", () => {
  assert.deepEqual(clusterSort(["cluster:rppa", "AGE"], "mrna", true), ["cluster:mrna", "AGE"]);
});

test("K3: Don't cluster drops this profile's cluster key (RVU 466-530, RVO 1302-1307)", () => {
  assert.deepEqual(clusterSort(["cluster:mrna", "AGE"], "mrna", false), ["AGE"]);
});

test("K4: Don't cluster drops clustering left in a tiebreaker (RVU 466-530, RVO 1302-1307)", () => {
  assert.deepEqual(clusterSort(["AGE", "cluster:mrna"], "mrna", false), ["AGE"]);
});

test("K5: Cluster keeps at most 4 keys, cluster first (RVU 466-530)", () => {
  assert.deepEqual(clusterSort(["a", "b", "c", "d"], "mrna", true), ["cluster:mrna", "a", "b", "c"]);
});

test("K6: Don't cluster while another profile is clustered changes nothing (RVU 466-530)", () => {
  assert.deepEqual(clusterSort(["cluster:rppa", "AGE"], "mrna", false), ["cluster:rppa", "AGE"]);
});

test("K7: clusteredProfile finds the clustered profile wherever its key sits (RVU 466-530)", () => {
  assert.equal(clusteredProfile(["AGE", "cluster:mrna"]), "mrna");
  assert.equal(clusteredProfile(["cluster:rppa"]), "rppa");
  assert.equal(clusteredProfile(["AGE"]), null);
  assert.equal(clusteredProfile([]), null);
});

test("T1: Sort a-Z puts the track first and ends clustering (RVO 1712-1719)", () => {
  assert.deepEqual(trackSort(["cluster:mrna", "AGE"], "SEX", ""), ["SEX", "AGE"]);
});

test("T2: Sort Z-a puts the track first and ends clustering (RVO 1712-1719)", () => {
  assert.deepEqual(trackSort(["cluster:mrna"], "SEX", "-"), ["-SEX"]);
});

test("T3: Don't sort drops only the track's key, clustering kept (RVO 1712-1719)", () => {
  assert.deepEqual(trackSort(["AGE", "cluster:mrna"], "AGE", null), ["cluster:mrna"]);
});

test("T4: re-sorting a track replaces its other direction (RVO 1712-1719)", () => {
  assert.deepEqual(trackSort(["-SEX", "AGE"], "SEX", ""), ["SEX", "AGE"]);
});

test("T5: track sort keeps at most 4 keys (RVO 1712-1719)", () => {
  assert.deepEqual(trackSort(["a", "b", "c", "d"], "SEX", ""), ["SEX", "a", "b", "c"]);
});

test("S1: the sort select replaces the primary clustering key (RVO 1302-1307)", () => {
  assert.deepEqual(selectSort(["cluster:mrna", "AGE"], "genomic"), ["genomic", "AGE"]);
});

test("S2: the sort select drops clustering from the tiebreakers (RVO 1302-1307)", () => {
  assert.deepEqual(selectSort(["AGE", "cluster:mrna"], "id"), ["id"]);
});

test("S3: the engine's order drops the old primary key (RVO 1302-1307)", () => {
  assert.deepEqual(selectSort(["genomic", "AGE"], ""), ["AGE"]);
});

test("S4: the sort select replaces the first key, keeping 4 (RVO 1302-1307)", () => {
  assert.deepEqual(selectSort(["a", "b", "c", "d"], "x"), ["x", "b", "c", "d"]);
});

test("M1: Cluster on mrna then Sort a-Z on SEX leaves nothing clustered (RVU 466-530, RVO 1712-1719)", () => {
  assert.equal(clusteredProfile(trackSort(clusterSort([], "mrna", true), "SEX", "")), null);
});
