// Written from docs/legacy-spec/parity/study-cn-segments-cases.md (CS, CI, CF; each test names the
// row it checks), without reference to the implementation.
// Covered elsewhere, not here (route / UI / database):
//   CF2 the figure's hiding itself (only the condition it keys on, the no-data line, is checked);
//   CF3 the download, not built
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CN_SEGMENTS_COHORT, CN_SEGMENTS_SAMPLE_LIMIT, cnSegmentsDoc, cnSegmentsInfo, cnSegmentsReads, cnSegmentsTab,
  type CnSegmentsSettings,
} from "../lib/study-view-cn-segments.ts";
import { AnalysisRequest, parseBody } from "../lib/api-schemas.ts";
import { DOC_VERSION, upgradeDocument } from "../lib/doc-version.ts";
import type { AnalysisDoc, CohortDef } from "../lib/types.ts";
import type { SegmentsView } from "../lib/views/segments/types.ts";

const STUDY = "brca_tcga_pan_can_atlas_2018";
const def: CohortDef = { studies: [STUDY], all: [] };

const TOO_MANY = "Too many samples (>20000) for copy number segmentation view, make a selection on Summary tab first.";
const withData = (n: string) => `Segmented copy-number data for the selected ${n}.`;
const noData = (n: string) => `No segmented copy-number data for the selected ${n}.`;

/** the doc's one view, checked to be the segments view over the selection */
function theView(doc: AnalysisDoc): SegmentsView {
  assert.equal(doc.views?.length, 1, "exactly one view");
  const v = doc.views[0];
  assert.equal(v.kind, "segments");
  const s = v as SegmentsView;
  assert.deepEqual(s.cohorts, [CN_SEGMENTS_COHORT]);
  return s;
}

// ---- cnSegmentsTab (CS1–CS3) ----

test("CS1: a study with segments offers the tab", () => {
  assert.equal(cnSegmentsTab([{ caps: { seg: true } }]), true);
});

test("CS1: one study with segments among several without offers the tab", () => {
  assert.equal(cnSegmentsTab([
    { caps: { seg: false, mutations: true } },
    { caps: { mutations: true } },
    { caps: { seg: true } },
  ]), true);
});

test("CS2: no study with segments: no tab", () => {
  assert.equal(cnSegmentsTab([{ caps: { seg: false } }, { caps: { seg: false, mutations: true } }]), false);
});

test("CS2: no studies: no tab", () => {
  assert.equal(cnSegmentsTab([]), false);
});

test("CS3: a peer study (no caps, or caps without seg) never offers the tab alone", () => {
  assert.equal(cnSegmentsTab([{}]), false);
  assert.equal(cnSegmentsTab([{ caps: {} }]), false);
  assert.equal(cnSegmentsTab([{}, { caps: { mutations: true } }]), false);
});

test("CS3: a peer study beside a local study with segments still offers the tab", () => {
  assert.equal(cnSegmentsTab([{}, { caps: { seg: true } }]), true);
});

// ---- cnSegmentsReads (CI5, CI6) ----

test("CI6: exactly 20,000 selected samples are read (the limit is 20,000)", () => {
  assert.equal(CN_SEGMENTS_SAMPLE_LIMIT, 20000);
  assert.equal(cnSegmentsReads(20000), true);
});

test("CI6: below the limit (19,999, 1) is read", () => {
  assert.equal(cnSegmentsReads(19999), true);
  assert.equal(cnSegmentsReads(1), true);
});

test("CI5: more than 20,000 (20,001 and far more) is not read", () => {
  assert.equal(cnSegmentsReads(20001), false);
  assert.equal(cnSegmentsReads(1_000_000), false);
});

// ---- cnSegmentsInfo (CI1–CI6) ----

test("CI1: with data, the selected count written plainly", () => {
  assert.equal(cnSegmentsInfo(1084, 1084), withData("1084 samples"));
  assert.equal(cnSegmentsInfo(1084, 12), withData("1084 samples"), "N is the selected samples, not the segmented ones");
});

test("CI1: no thousands separator", () => {
  const line = cnSegmentsInfo(12345, 100);
  assert.equal(line, withData("12345 samples"));
  assert.ok(!line.includes("12,345"));
});

test("CI2: one sample is 'sample'", () => {
  assert.equal(cnSegmentsInfo(1, 1), withData("1 sample"));
});

test("CI2: two samples are 'samples'", () => {
  assert.equal(cnSegmentsInfo(2, 1), withData("2 samples"));
});

test("CI3: read and none segmented: the no-data line", () => {
  assert.equal(cnSegmentsInfo(1084, 0), noData("1084 samples"));
});

test("CI3: read and none segmented, one sample", () => {
  assert.equal(cnSegmentsInfo(1, 0), noData("1 sample"));
});

test("CI4: while reading (segmented null) the line says 'Segmented', not 'No segmented'", () => {
  assert.equal(cnSegmentsInfo(1084, null), withData("1084 samples"));
  assert.equal(cnSegmentsInfo(1, null), withData("1 sample"));
});

test("CI3/CI4: segmented 0 vs null vs >0 for the same selection", () => {
  assert.equal(cnSegmentsInfo(50, 0), noData("50 samples"));
  assert.equal(cnSegmentsInfo(50, null), withData("50 samples"));
  assert.equal(cnSegmentsInfo(50, 1), withData("50 samples"));
});

test("CI5: more than 20,000 selected: the too-many line, whatever segmented is", () => {
  assert.equal(cnSegmentsInfo(20001, null), TOO_MANY);
  assert.equal(cnSegmentsInfo(20001, 0), TOO_MANY);
  assert.equal(cnSegmentsInfo(20001, 5), TOO_MANY);
  assert.equal(cnSegmentsInfo(150000, null), TOO_MANY);
});

test("CI6: exactly 20,000 selected: the ordinary lines, not too-many", () => {
  assert.equal(cnSegmentsInfo(20000, 20000), withData("20000 samples"));
  assert.equal(cnSegmentsInfo(20000, null), withData("20000 samples"));
  assert.equal(cnSegmentsInfo(20000, 0), noData("20000 samples"));
});

test("CI6: 19,999 selected: the ordinary line", () => {
  assert.equal(cnSegmentsInfo(19999, 3), withData("19999 samples"));
});

// ---- cnSegmentsDoc (CF1, CF2) ----

test("CF1: the doc is one segments view over the selection cohort, on the whole genome", () => {
  const doc = cnSegmentsDoc(def, STUDY);
  assert.equal(doc.dsl, DOC_VERSION);
  assert.equal(doc.study, STUDY);
  assert.deepEqual(doc.cohorts, { [CN_SEGMENTS_COHORT]: def });
  assert.deepEqual(Object.keys(doc.cohorts), [CN_SEGMENTS_COHORT]);
  const v = theView(doc);
  assert.deepEqual(v, { kind: "segments", cohorts: [CN_SEGMENTS_COHORT] }, "no gene, region, rows or sort keys, not even undefined");
  for (const k of ["gene", "region", "rows", "sort", "overview"]) assert.ok(!(k in v), k + " absent");
});

test("CF1: an empty settings object adds nothing to the view", () => {
  const v = theView(cnSegmentsDoc(def, STUDY, {}));
  assert.deepEqual(Object.keys(v).sort(), ["cohorts", "kind"]);
});

test("CF1: settings given are copied onto the view", () => {
  const settings: CnSegmentsSettings = { gene: "ERBB2", rows: 200, sort: "gained" };
  const v = theView(cnSegmentsDoc(def, STUDY, settings));
  assert.deepEqual(v, { kind: "segments", cohorts: [CN_SEGMENTS_COHORT], gene: "ERBB2", rows: 200, sort: "gained" });
  assert.ok(!("region" in v));
});

test("CF1: a region and sort lost are copied; only the keys given appear", () => {
  const v = theView(cnSegmentsDoc(def, STUDY, { region: "chr17:37,000,000-38,000,000", sort: "lost" }));
  assert.deepEqual(v, { kind: "segments", cohorts: [CN_SEGMENTS_COHORT], region: "chr17:37,000,000-38,000,000", sort: "lost" });
  assert.ok(!("gene" in v));
  assert.ok(!("rows" in v));
});

test("CF1: settings with undefined values leave no undefined keys on the view", () => {
  const v = theView(cnSegmentsDoc(def, STUDY, { gene: undefined, region: undefined, rows: undefined, sort: undefined }));
  assert.deepEqual(Object.keys(v).sort(), ["cohorts", "kind"]);
});

test("CF1: the cohort definition and settings given are not changed", () => {
  const d: CohortDef = { studies: [STUDY], all: [] };
  const s: CnSegmentsSettings = { gene: "TP53", rows: 50 };
  const dCopy = structuredClone(d);
  const sCopy = structuredClone(s);
  cnSegmentsDoc(d, STUDY, s);
  assert.deepEqual(d, dCopy);
  assert.deepEqual(s, sCopy);
});

test("CF1: the doc is accepted as an analysis request and is already current", () => {
  const doc = cnSegmentsDoc(def, STUDY, { gene: "ERBB2", sort: "gained", rows: 300 });
  const body = parseBody(AnalysisRequest, doc);
  assert.equal(body.views?.[0].kind, "segments");
  const { upgrade } = upgradeDocument(structuredClone(doc));
  assert.ok(upgrade === null || upgrade.changes.length === 0, "no upgrade step changes it");
});

test("CF2: under CI3 the line the tab hides the figure on is the no-data line", () => {
  assert.ok(cnSegmentsInfo(300, 0).startsWith("No segmented"));
  assert.ok(!cnSegmentsInfo(300, null).startsWith("No segmented"));
  assert.ok(!cnSegmentsInfo(300, 7).startsWith("No segmented"));
});
