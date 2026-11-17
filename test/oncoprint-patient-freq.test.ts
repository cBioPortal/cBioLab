// A patient-level attribute's Freq in the oncoprint's Tracks menu, counted in samples as the portal counts it.
//
// Legacy source (~/cbioportal-frontend at cd8c6df; backend ~/cbioportal at 03c0280):
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts 1237-1300 clinicalAttributeIdToAvailableSampleCount:
//          getClinicalAttributeCountsUsingPOST over the queried samples (a sample list, or sample identifiers), and
//          the rows' counts summed per attribute id (so over studies).
//   BE   = cbioportal src/main/resources/org/cbioportal/legacy/persistence/mybatis/ClinicalAttributeMapper.xml
//          getClinicalAttributeCountsBySampleIds / BySampleListId: the clinical_patient branch joins
//          patient -> sample and counts rows filtered by the queried samples, i.e. the queried SAMPLES whose
//          patient has a value.
//   TM   = src/pages/resultsView/oncoprint/TracksMenu.tsx 242-256: Freq = 100 * count / queried samples, every attribute.
//
// Cases F6/F7 (SQL on the fixture) and F8 (the tooltip text) are not here.
import test from "node:test";
import assert from "node:assert/strict";
import { clinicalTrackRows, trackAttrs, trackFreqText, tracksMenuRows, type TrackAttr } from "../app/_oncoprint/track-edits.ts";
import { mergeExplore } from "../lib/explore.ts";

const pAttr = (attribute: string, patients: number, samples?: number, priority?: number): TrackAttr =>
  ({ attribute, kind: "cat", patients, per: "patient", ...(samples != null ? { samples } : {}), ...(priority != null ? { priority } : {}) } as TrackAttr);
const sAttr = (attribute: string, n: number): TrackAttr => ({ attribute, kind: "cat", patients: n, per: "sample" });
const TOTALS = { patients: 20, samples: 30 };

test("F1: a patient attribute with `samples` is its samples / the queried samples, unit samples (RVPS, BE, TM)", () => {
  const [r] = clinicalTrackRows([pAttr("OS_MONTHS", 10, 14)], TOTALS);
  assert.equal(trackFreqText(r.pct), "46.7%"); // 14 / 30, not 10 / 20 = 50.0%
  assert.ok(Math.abs((r.pct as number) - 100 * 14 / 30) < 1e-9);
  assert.equal(r.unit, "samples");
});

test("F1: msk_impact_2017 OS_MONTHS — 8,142 of 10,945 samples = 74.4%, as the portal (not 7,574 / 10,336 patients = 73.3%)", () => {
  const [r] = clinicalTrackRows([pAttr("OS_MONTHS", 7574, 8142)], { patients: 10336, samples: 10945 });
  assert.equal(trackFreqText(r.pct), "74.4%");
  assert.equal(r.unit, "samples");
});

test("F1: `samples: 0` is present, so it is 0 of the queried samples, unit samples", () => {
  const [r] = clinicalTrackRows([pAttr("PATIENT_FLAG", 0, 0)], TOTALS);
  assert.equal(r.pct, 0);
  assert.equal(r.unit, "samples");
});

test("F1: trackAttrs copies a facet's `samples` onto the attribute, on the declared and the undeclared path", () => {
  const got = trackAttrs({
    clinical: [{ attribute: "OS_MONTHS", kind: "num", patients: 10, per: "patient", samples: 14 } as never,
      { attribute: "X_UPLOAD", kind: "cat", patients: 3, per: "patient", samples: 5 } as never],
    declaredAttributes: [{ attribute: "OS_MONTHS", per: "patient", priority: 1 }],
  });
  const by = new Map(got.map((a) => [a.attribute, a]));
  assert.equal((by.get("OS_MONTHS") as TrackAttr & { samples?: number }).samples, 14, "declared path");
  assert.equal((by.get("X_UPLOAD") as TrackAttr & { samples?: number }).samples, 5, "undeclared path");
  const rows = clinicalTrackRows(got, TOTALS);
  assert.deepEqual(rows.map((r) => [r.attribute, trackFreqText(r.pct), r.unit]),
    [["OS_MONTHS", "46.7%", "samples"], ["X_UPLOAD", "16.7%", "samples"]]);
});

test("F2: a patient attribute without `samples` (an older peer) is patients / patients, unit patients, as today", () => {
  const [r] = clinicalTrackRows([pAttr("OS_MONTHS", 10)], TOTALS);
  assert.equal(r.pct, 50);
  assert.equal(r.unit, "patients");
  const [viaTrackAttrs] = trackAttrs({ clinical: [{ attribute: "OS_MONTHS", kind: "num", patients: 10, per: "patient" }] });
  assert.equal("samples" in viaTrackAttrs, false, "no `samples` invented when the facet has none");
});

test("F3: a sample attribute is unchanged: its samples / the queried samples (TM)", () => {
  const [r] = clinicalTrackRows([sAttr("SAMPLE_TYPE", 12)], TOTALS);
  assert.equal(r.pct, 40);
  assert.equal(r.unit, "samples");
});

// ---- the cross-study merge (RVPS: the per-study rows' counts are summed per attribute id) ---------

const part = (study: string, f: { patients: number; samples?: number }, totals: { patients: number; samples: number }) =>
  ({ study, draftCount: null, events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, totals,
    clinical: [{ kind: "cat", attribute: "OS_STATUS", per: "patient", patients: f.patients, ...(f.samples != null ? { samples: f.samples } : {}),
      displayName: "Overall Survival Status", priority: 1, values: [{ v: "LIVING", n: f.patients }] }] });

test("F4: merging two studies' facets that both carry `samples` (5, 7) sums them: 12 (RVPS)", () => {
  const merged = mergeExplore([part("s1", { patients: 4, samples: 5 }, { patients: 6, samples: 8 }),
    part("s2", { patients: 6, samples: 7 }, { patients: 9, samples: 12 })] as never);
  const f = merged.clinical.find((c) => c.attribute === "OS_STATUS") as { samples?: number; patients: number };
  assert.equal(f.patients, 10);
  assert.equal(f.samples, 12);
  const [r] = clinicalTrackRows(trackAttrs(merged as never), merged.totals);
  assert.equal(trackFreqText(r.pct), "60.0%"); // 12 / 20
  assert.equal(r.unit, "samples");
});

test("F5: merging where one part's facet lacks `samples` leaves it absent, so the Freq falls back to patients", () => {
  const merged = mergeExplore([part("s1", { patients: 4, samples: 5 }, { patients: 6, samples: 8 }),
    part("s2", { patients: 6 }, { patients: 9, samples: 12 })] as never);
  const f = merged.clinical.find((c) => c.attribute === "OS_STATUS") as { samples?: number };
  assert.equal(f.samples, undefined);
  assert.equal("samples" in f, false);
  const [r] = clinicalTrackRows(trackAttrs(merged as never), merged.totals);
  assert.equal(r.unit, "patients");
  assert.equal(trackFreqText(r.pct), "66.7%"); // 10 / 15
});

// ---- order (TM 185-213: by Freq, then priority, then name) -----------------------------------------

test("F9: the rows are ordered by the samples-based Freq, not the patients-based one", () => {
  // totals 20 patients / 30 samples. A: 10 patients (50%) holding 12 samples (40.0%); B: 9 patients (45%) holding 15 samples (50.0%).
  const attrs = [pAttr("A", 10, 12), pAttr("B", 9, 15), sAttr("C", 13) /* 43.3% */];
  assert.deepEqual(clinicalTrackRows(attrs, TOTALS).map((r) => r.attribute), ["B", "C", "A"]);
  const menu = tracksMenuRows({ attrs, totals: TOTALS, autoTracks: [] });
  assert.deepEqual(menu.map((r) => r.attribute), ["B", "C", "A"]);
});

test("F9: a tie on the samples-based Freq falls to priority, then name", () => {
  // all 15 / 30 = 50% in samples; in patients Zeta (11/20) would lead Mid and Alpha (8/20)
  const attrs = [pAttr("Zeta", 11, 15, 0), pAttr("Alpha", 8, 15, 0), pAttr("Mid", 8, 15, 5)];
  assert.deepEqual(clinicalTrackRows(attrs, TOTALS).map((r) => r.attribute), ["Mid", "Alpha", "Zeta"]);
});
