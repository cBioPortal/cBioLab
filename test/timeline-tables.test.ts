// eventTables (lib/timeline-tables.ts): a patient's events as one table per event type.
// Legacy cBioPortal ClinicalEventsTables / timelineDataUtils; spec docs/legacy-spec/41-patient-tabs.md PTB-CD-4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventTables } from "../lib/timeline-tables.ts";
import type { PatientEvent } from "../lib/types.ts";

const ev = (type: string, start: number, end: number | null, attrs: [string, string][] = []): PatientEvent => ({ type, start, end, attrs });

test("E1 PTB-CD-4: tables per type in first-seen order, rows in input order", () => {
  const t = eventTables([ev("SPECIMEN", 1, null, [["A", "a1"]]), ev("STATUS", 2, null), ev("SPECIMEN", 3, null, [["A", "a3"]])]);
  assert.deepEqual(t.map((x) => x.type), ["SPECIMEN", "STATUS"]);
  assert.equal(t[0].rows.length, 2);
  assert.deepEqual(t[0].rows.map((r) => r[0]), ["1", "3"]);
});

test("E2 PTB-CD-4: columns are the fixed three then the attribute keys in first-seen order", () => {
  const [t] = eventTables([ev("X", 1, null, [["B", "1"], ["A", "2"]]), ev("X", 2, null, [["C", "3"], ["B", "4"]])]);
  assert.deepEqual(t.columns, ["START_DATE", "STOP_DATE", "EVENT_TYPE", "B", "A", "C"]);
});

test("E3 PTB-CD-4: PATIENT_ID and STYLE_ attributes are left out", () => {
  const [t] = eventTables([ev("X", 1, null, [["PATIENT_ID", "P"], ["STYLE_COLOR", "red"], ["style_shape", "c"], ["Style_Other", "o"], ["KEEP", "k"]])]);
  assert.deepEqual(t.columns, ["START_DATE", "STOP_DATE", "EVENT_TYPE", "KEEP"]);
  assert.deepEqual(t.rows[0], ["1", "", "X", "k"]);
});

test("E4 PTB-CD-4: values; a missing attribute is empty", () => {
  const [t] = eventTables([ev("Lab", 5, 9, [["A", "x"]]), ev("Lab", -2, null, [["B", "y"]])]);
  assert.deepEqual(t.rows, [["5", "9", "Lab", "x", ""], ["-2", "", "Lab", "", "y"]]);
});

test("E5 PTB-CD-4: title is capitalised first letter, rest lower case", () => {
  const title = (type: string) => eventTables([ev(type, 0, null)])[0].title;
  assert.equal(title("SPECIMEN"), "Specimen");
  assert.equal(title("Lab_test"), "Lab_test");
  assert.equal(title("treatment"), "Treatment");
});

test("E6 PTB-CD-4: no events give no tables", () => {
  assert.deepEqual(eventTables([]), []);
});
