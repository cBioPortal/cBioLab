// Written from docs/legacy-spec/parity/download-cases.md, "Summary Data (SD)" (one test per row
// these pure functions cover, named by its id) and the legacy source each row cites
// (~/cbioportal-frontend at cd8c6df), without reference to the implementation.
// Covered elsewhere, not here (UI wiring):
//   SD1  the Download submenu is the chart menu's last item, entries in order
//   SD12 a chart under its own filter downloads the counts it shows
//   SD14 gene-state charts write the state as the chart names it
// SD8 and SD11 are produced upstream (the NA category and the per-study sums arrive in `counts`);
// the tests below check how summaryDataTsv writes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chartFileName, summaryDataTsv, summaryCut, type CategoryCount } from "../lib/study-view-download.ts";

const HEADER_SAMPLES = "Category\tNumber of samples\tPercentage of samples";
const HEADER_PATIENTS = "Category\tNumber of patients\tPercentage of patients";

const c = (value: string, count: number): CategoryCount => ({ value, count });
const lines = (tsv: string) => tsv.split("\n");
const rows = (tsv: string) => lines(tsv).slice(1).map(l => l.split("\t"));
const order = (tsv: string) => rows(tsv).map(r => r[0]);
/** the percentage column for a category, by value */
const pctOf = (tsv: string, value: string) => {
  const r = rows(tsv).find(r => r[0] === value);
  assert.ok(r, `no row for ${value}`);
  return r[2];
};

// ---- SD2. File name ----

test("SD2: spaces become _, then .summary.txt", () => {
  assert.equal(chartFileName("Cancer Type Detailed", "summary"), "Cancer_Type_Detailed.summary.txt");
});

test("SD2: each tab becomes _, and every space, including runs and ends", () => {
  assert.equal(chartFileName("A\tB", "summary"), "A_B.summary.txt");
  assert.equal(chartFileName("A  B\t\tC", "summary"), "A__B__C.summary.txt");
  assert.equal(chartFileName(" Sex ", "summary"), "_Sex_.summary.txt");
});

test("SD2: other characters are kept", () => {
  assert.equal(chartFileName("TP53: Mutations", "summary"), "TP53:_Mutations.summary.txt");
  assert.equal(chartFileName("MSI/MSS (score) #1 & é", "summary"), "MSI/MSS_(score)_#1_&_é.summary.txt");
  assert.equal(chartFileName("Overall_Survival-Status", "summary"), "Overall_Survival-Status.summary.txt");
});

test("SD2: each file kind's suffix", () => {
  assert.equal(chartFileName("Sample Type", "summary"), "Sample_Type.summary.txt");
  assert.equal(chartFileName("Sample Type", "full"), "Sample_Type.full.txt");
  assert.equal(chartFileName("Sample Type", "data"), "Sample_Type.txt");
});

// ---- SD3. Header ----

test("SD3: sample-level header, tab-separated", () => {
  assert.equal(lines(summaryDataTsv([c("Male", 3)], "sample"))[0], HEADER_SAMPLES);
});

test("SD3: patient-level header says patients, lower case", () => {
  assert.equal(lines(summaryDataTsv([c("Male", 3)], "patient"))[0], HEADER_PATIENTS);
});

// ---- SD4. A row ----

test("SD4: one row per category: value, count, percentage", () => {
  const tsv = summaryDataTsv([c("Male", 3), c("Female", 1)], "sample");
  assert.equal(tsv, `${HEADER_SAMPLES}\nMale\t3\t75.0%\nFemale\t1\t25.0%`);
});

test("SD4: the value is written as stored (case, spacing, punctuation, no quoting)", () => {
  const tsv = summaryDataTsv(
    [c("Primary Solid tumor", 4), c("  padded value ", 3), c('say "hi", ok', 2), c("Ménétrier", 1)],
    "sample"
  );
  assert.deepEqual(order(tsv), ["Primary Solid tumor", "  padded value ", 'say "hi", ok', "Ménétrier"]);
});

// ---- SD5. Percentage ----

test("SD5: count ÷ sum of every count × 100, NA's count in the sum", () => {
  const tsv = summaryDataTsv([c("A", 1), c("B", 1), c("NA", 2)], "sample");
  assert.equal(pctOf(tsv, "A"), "25.0%");
  assert.equal(pctOf(tsv, "B"), "25.0%");
  assert.equal(pctOf(tsv, "NA"), "50.0%");
});

test("SD5: one-decimal rounding of thirds", () => {
  const tsv = summaryDataTsv([c("A", 2), c("B", 1)], "sample");
  assert.equal(pctOf(tsv, "A"), "66.7%");
  assert.equal(pctOf(tsv, "B"), "33.3%");
});

// ---- SD6. Percentage strings (through portalFreq) ----

test("SD6: a single category is 100.0%", () => {
  assert.equal(summaryDataTsv([c("Only", 7)], "sample"), `${HEADER_SAMPLES}\nOnly\t7\t100.0%`);
});

test("SD6: 99.95% is written 99.9%, not 100.0%", () => {
  const tsv = summaryDataTsv([c("Big", 1999), c("Small", 1)], "sample");
  assert.equal(pctOf(tsv, "Big"), "99.9%");
  assert.equal(pctOf(tsv, "Small"), "<0.1%");
});

test("SD6: from 99.9 up to 100 is 99.9%", () => {
  const tsv = summaryDataTsv([c("Big", 999), c("Small", 1)], "sample");
  assert.equal(pctOf(tsv, "Big"), "99.9%");
  assert.equal(pctOf(tsv, "Small"), "0.1%");
});

test("SD6: exactly 0.1% has one decimal; just below is <0.1%", () => {
  const atTenth = summaryDataTsv([c("Big", 999), c("Small", 1)], "sample");
  assert.equal(pctOf(atTenth, "Small"), "0.1%");
  const below = summaryDataTsv([c("Big", 1000), c("Small", 1)], "sample");
  assert.equal(pctOf(below, "Small"), "<0.1%");
  const tiny = summaryDataTsv([c("Big", 100000), c("Small", 1)], "sample");
  assert.equal(pctOf(tiny, "Small"), "<0.1%");
});

test("SD6: a zero count is 0%", () => {
  const tsv = summaryDataTsv([c("A", 5), c("B", 0)], "sample");
  assert.equal(pctOf(tsv, "B"), "0%");
  assert.equal(pctOf(tsv, "A"), "100.0%");
});

test("SD6: every count zero (sum 0) is NA", () => {
  const tsv = summaryDataTsv([c("A", 0), c("B", 0)], "sample");
  assert.equal(tsv, `${HEADER_SAMPLES}\nA\t0\tNA\nB\t0\tNA`);
});

// ---- SD7. Order ----

test("SD7: by count, highest first", () => {
  const tsv = summaryDataTsv([c("low", 1), c("high", 9), c("mid", 5)], "sample");
  assert.deepEqual(order(tsv), ["high", "mid", "low"]);
});

test("SD7: ties keep the order the counts arrived in", () => {
  const tsv = summaryDataTsv([c("b", 2), c("a", 2), c("z", 5), c("c", 2), c("y", 5)], "sample");
  assert.deepEqual(order(tsv), ["z", "y", "b", "a", "c"]);
});

test("SD7: an NA-like value goes last even with the highest count", () => {
  const tsv = summaryDataTsv([c("NA", 100), c("A", 1), c("B", 2)], "sample");
  assert.deepEqual(order(tsv), ["B", "A", "NA"]);
});

test("SD7: na, ' NA ', Na and tab-padded na all read as NA", () => {
  for (const na of ["na", " NA ", "Na", "nA", "\tna\n"]) {
    const tsv = summaryDataTsv([c(na, 50), c("X", 1)], "sample");
    // a value holding a tab or LF is written raw (SD10), so compare positions in the text, not parsed rows
    const x = tsv.indexOf("\nX\t"), n = tsv.indexOf("\n" + na + "\t");
    assert.ok(x > 0 && n > x, JSON.stringify(na));
  }
});

test("SD7: two NA-like values keep their arrival order, after the rest", () => {
  const tsv = summaryDataTsv([c("na", 1), c("A", 3), c("NA", 9), c("B", 4)], "sample");
  assert.deepEqual(order(tsv), ["B", "A", "na", "NA"]);
});

test("SD7: values that only contain na are ordinary", () => {
  const tsv = summaryDataTsv([c("N/A", 1), c("NaN", 2), c("NAN", 3), c("Not Available", 4), c("NA", 10)], "sample");
  assert.deepEqual(order(tsv), ["Not Available", "NAN", "NaN", "N/A", "NA"]);
});

// ---- SD8. NA ----

test("SD8: the NA category is written as a row of its own, value NA", () => {
  const tsv = summaryDataTsv([c("NA", 1), c("Yes", 3)], "patient");
  assert.equal(tsv, `${HEADER_PATIENTS}\nYes\t3\t75.0%\nNA\t1\t25.0%`);
});

// ---- SD9. No categories ----

test("SD9: no categories → the header only, no trailing newline", () => {
  assert.equal(summaryDataTsv([], "sample"), HEADER_SAMPLES);
  assert.equal(summaryDataTsv([], "patient"), HEADER_PATIENTS);
});

// ---- SD10. Layout ----

test("SD10: LF only, no line ending after the last line", () => {
  const tsv = summaryDataTsv([c("A", 2), c("B", 1)], "sample");
  assert.ok(!tsv.includes("\r"), "contains CR");
  assert.ok(!tsv.endsWith("\n"), "ends with LF");
  assert.equal(lines(tsv).length, 3);
});

test("SD10: counts are plain integers, no thousands separators", () => {
  const tsv = summaryDataTsv([c("A", 12345), c("B", 1234567)], "sample");
  assert.deepEqual(rows(tsv).map(r => r[1]), ["1234567", "12345"]);
});

test("SD10: no BOM; non-ASCII kept as-is", () => {
  const tsv = summaryDataTsv([c("Ménétrier", 1)], "sample");
  assert.ok(!tsv.startsWith("﻿"), "starts with a BOM");
  assert.ok(tsv.startsWith("Category\t"));
  assert.equal(order(tsv)[0], "Ménétrier");
});

// ---- SD11. Several studies ----

test("SD11: three columns per row, no study column", () => {
  const tsv = summaryDataTsv([c("A", 30), c("B", 20), c("NA", 5)], "sample");
  for (const l of lines(tsv)) assert.equal(l.split("\t").length, 3, l);
});

// ---- SD13. Values cut ----

const hasNumber = (s: string, n: number) =>
  s.includes(String(n)) || s.includes(n.toLocaleString("en-US"));

test("SD13: null when the chart holds every value", () => {
  assert.equal(summaryCut(200, 200), null);
  assert.equal(summaryCut(0, 0), null);
  assert.equal(summaryCut(3, 3), null);
});

test("SD13: null when the distinct count is unknown", () => {
  assert.equal(summaryCut(200, undefined), null);
  assert.equal(summaryCut(0, undefined), null);
});

test("SD13: null when shown exceeds distinct", () => {
  assert.equal(summaryCut(201, 200), null);
});

test("SD13: when cut, a sentence naming how many it holds of how many", () => {
  const s = summaryCut(200, 1234);
  assert.equal(typeof s, "string");
  assert.ok(s!.trim().length > 0);
  assert.ok(hasNumber(s!, 200), s!);
  assert.ok(hasNumber(s!, 1234), s!);
  const t = summaryCut(199, 200);
  assert.ok(t && hasNumber(t, 199) && hasNumber(t, 200), String(t));
});
