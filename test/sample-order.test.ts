// PAT-STM-12: the patient's samples are ordered as cBioPortal's SampleManager does (docs/legacy-spec/40-patient-summary.md):
// by the day of the SPECIMEN / SAMPLE ACQUISITION event (missing last), then type (primary, metastasis, cfdna, other), then natural id.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sampleMarks } from "../lib/timeline-tracks.ts";
import { patientSampleEvents } from "../lib/views/shared.ts";
import type { PatientEvent } from "../lib/types.ts";
import type { ViewRun } from "../lib/views/run.ts";

const acq = (type: string, id: string, day: number): PatientEvent => ({ type, start: day, end: null, attrs: [["SAMPLE_ID", id]] });
const labels = (m: ReturnType<typeof sampleMarks>) => Object.fromEntries([...m.values()].map((x) => [x.id, x.label]));

describe("PAT-STM-12 sampleMarks", () => {
  test("N1 PAT-STM-12: sample-acquisition events number the earlier first", () => {
    const m = sampleMarks([{ id: "T01", type: "Primary" }, { id: "T02", type: "Primary" }], [acq("Sample acquisition", "T01", -40), acq("Sample acquisition", "T02", -56)]);
    assert.deepEqual(labels(m), { T02: "1", T01: "2" });
  });
  test("N2 PAT-STM-12: the same with a SPECIMEN event type", () => {
    const samples = [{ id: "T01", type: "Primary" }, { id: "T02", type: "Primary" }];
    for (const t of ["SPECIMEN", "Sample acquisition"])
      assert.deepEqual(labels(sampleMarks(samples, [acq(t, "T01", -40), acq(t, "T02", -56)])), { T02: "1", T01: "2" }, t);
  });
  test("N3 PAT-STM-12: a dated sample comes before an undated one, whatever the type", () => {
    const m = sampleMarks([{ id: "A", type: "Primary" }, { id: "B", type: "Metastasis" }], [acq("Sample acquisition", "B", 5)]);
    assert.deepEqual(labels(m), { B: "1", A: "2" });
  });
  test("N4 PAT-STM-12: with no days the primary comes first", () => {
    assert.deepEqual(labels(sampleMarks([{ id: "A1", type: "Metastasis" }, { id: "B1", type: "Primary" }], [])), { B1: "1", A1: "2" });
  });
  test("N5 PAT-STM-12: with no days and one type the id sorts naturally", () => {
    assert.deepEqual(labels(sampleMarks([{ id: "S10", type: "Primary" }, { id: "S2", type: "Primary" }], [])), { S2: "1", S10: "2" });
  });
});

describe("PAT-STM-12 patientSampleEvents", () => {
  const ctxOf = (resolver: unknown) => ({ resolvers: { s1: resolver } }) as unknown as ViewRun;
  const events = [acq("Sample acquisition", "T02", -56)];
  test("W1 PAT-STM-12: the timeline's events are returned with no note", async () => {
    const patientTimeline = async () => ({ events, samples: [], source: { label: "x" } });
    assert.deepEqual(await patientSampleEvents(ctxOf({ patientTimeline }), "s1", "P1"), { events, note: null });
  });
  test("W2 PAT-STM-12: a resolver without patientTimeline gives no events and a note naming the patient", async () => {
    const out = await patientSampleEvents(ctxOf({}), "s1", "P1");
    assert.deepEqual(out.events, []);
    assert.match(String(out.note), /P1/);
  });
  test("W3 PAT-STM-12: a failing timeline resolves with no events and the reason in the note", async () => {
    const patientTimeline = async () => { throw new Error("timeline refused"); };
    const out = await patientSampleEvents(ctxOf({ patientTimeline }), "s1", "P1");
    assert.deepEqual(out.events, []);
    assert.match(String(out.note), /timeline refused/);
  });
  test("W4 PAT-STM-12: an abort is not swallowed", async () => {
    const patientTimeline = async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
    await assert.rejects(patientSampleEvents(ctxOf({ patientTimeline }), "s1", "P1"));
  });
});
