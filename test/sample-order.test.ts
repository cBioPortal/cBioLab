// PAT-STM-12: the patient's samples are ordered as cBioPortal's SampleManager does (docs/legacy-spec/40-patient-summary.md):
// by the day of the SPECIMEN / SAMPLE ACQUISITION event (missing last), then type (primary, metastasis, cfdna, other), then natural id.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sampleMarks } from "../lib/timeline-tracks.ts";
import { withSampleDays } from "../lib/views/shared.ts";
import type { PatientEvent } from "../lib/types.ts";
import type { ViewRun } from "../lib/views/run.ts";

const acq = (type: string, id: string, day: number): PatientEvent => ({ type, start: day, end: null, attrs: [["SAMPLE_ID", id]] });
const labels = (m: ReturnType<typeof sampleMarks>) => Object.fromEntries([...m.values()].map((x) => [x.id, x.label]));

describe("PAT-STM-12 sampleMarks", () => {
  test("N1 PAT-STM-12: days given on the samples number the earlier first", () => {
    const m = sampleMarks([{ id: "T01", type: "Primary", day: -40 }, { id: "T02", type: "Primary", day: -56 }], []);
    assert.deepEqual(labels(m), { T02: "1", T01: "2" });
  });
  test("N2 PAT-STM-12: the same days given as sample events", () => {
    const samples = [{ id: "T01", type: "Primary" }, { id: "T02", type: "Primary" }];
    for (const t of ["SPECIMEN", "Sample acquisition"])
      assert.deepEqual(labels(sampleMarks(samples, [acq(t, "T01", -40), acq(t, "T02", -56)])), { T02: "1", T01: "2" }, t);
  });
  test("N3 PAT-STM-12: a dated sample comes before an undated one, whatever the type", () => {
    const m = sampleMarks([{ id: "A", type: "Primary", day: null }, { id: "B", type: "Metastasis", day: 5 }], []);
    assert.deepEqual(labels(m), { B: "1", A: "2" });
  });
  test("N4 PAT-STM-12: with no days the primary comes first", () => {
    assert.deepEqual(labels(sampleMarks([{ id: "A1", type: "Metastasis" }, { id: "B1", type: "Primary" }], [])), { B1: "1", A1: "2" });
  });
  test("N5 PAT-STM-12: with no days and one type the id sorts naturally", () => {
    assert.deepEqual(labels(sampleMarks([{ id: "S10", type: "Primary" }, { id: "S2", type: "Primary" }], [])), { S2: "1", S10: "2" });
  });
});

describe("PAT-STM-12 withSampleDays", () => {
  const ctxOf = (resolver: unknown) => ({ resolvers: { s1: resolver } }) as unknown as ViewRun;
  const samples = [{ id: "T01", type: "Primary", extra: 1 }, { id: "T02", type: "Primary", extra: 2 }];
  test("W1 PAT-STM-12: days come from the timeline's sample events; other fields are kept", async () => {
    const patientTimeline = async () => ({ events: [acq("Sample acquisition", "T02", -56)], samples, source: { label: "x" } });
    const out = await withSampleDays(ctxOf({ patientTimeline }), "s1", "P1", samples);
    assert.deepEqual(out, [{ id: "T01", type: "Primary", extra: 1, day: null }, { id: "T02", type: "Primary", extra: 2, day: -56 }]);
  });
  test("W2 PAT-STM-12: a resolver without patientTimeline gives every day null", async () => {
    const out = await withSampleDays(ctxOf({}), "s1", "P1", samples);
    assert.deepEqual(out.map((s) => s.day), [null, null]);
  });
});
