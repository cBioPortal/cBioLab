// A numeric chart's menu (lib/study-view-bins.ts): when Log Scale is offered (STS-BAR-7), the
// Custom Bins dialog's input (STS-BAR-8, STS-STM-10), and the edges a typed pill interval adds (STV-FB-4).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { binEdges, binMethodName, binsAfterEdit, logScaleOffered, looksLogarithmic, oneValueBars, parseEdges, parseGenerate, serverBins } from "../lib/study-view-bins.ts";
import type { NumericBin } from "../lib/types.ts";

const AGE: NumericBin[] = [
  { special: "<=", end: 35, count: 8 },
  ...[35, 40, 45].map((s) => ({ start: s, end: s + 5, count: 10 })),
  { special: ">", start: 50, count: 3 },
  { value: "Unknown", count: 1 },
];
// DAYS_TO_BIRTH as coadread draws it
const LOG: NumericBin[] = [{ start: -100000, end: -31622, count: 21 }, { start: -31622, end: -10000, count: 569 }];

describe("Log Scale", () => {
  test("offered when the bars are on powers of ten in half steps", () => {
    assert.equal(looksLogarithmic(LOG), true);
    assert.equal(looksLogarithmic([{ start: 0, end: 1, count: 1 }, { start: 1, end: 3, count: 2 }, { start: 3, end: 10, count: 2 }, { start: 10, end: 31, count: 1 }]), true);
    assert.equal(looksLogarithmic(AGE), false);
    assert.equal(looksLogarithmic([{ start: 0.1, end: 1, count: 1 }]), false, "an edge between −1 and 1");
    assert.equal(looksLogarithmic([{ start: 1, end: 1, count: 1 }, { start: 10, end: 10, count: 1 }]), false, "one-value bars");
    assert.equal(looksLogarithmic(undefined), false);
  });
  test("still offered once switched off, so it can be switched on again", () => {
    assert.equal(logScaleOffered(AGE, { disableLog: true }), true);
    assert.equal(logScaleOffered(AGE, undefined), false);
    assert.equal(logScaleOffered(LOG, undefined), true);
  });
});

describe("Custom Bins input", () => {
  test("the box starts from the bars' edges, words left out", () => assert.deepEqual(binEdges(AGE), [35, 40, 45, 50]));
  test("edges: numbers split on commas, sorted, once each", () => assert.deepEqual(parseEdges(" 60, 40,40 ,80.5"), { edges: [40, 60, 80.5] }));
  test("an empty box is the default bars", () => assert.deepEqual(parseEdges("  , "), { edges: null }));
  test("anything not a number is refused, named", () => {
    const r = parseEdges("40, x, 60, 1e");
    assert.ok("why" in r && r.why.includes("x") && r.why.includes("1e"));
    assert.ok("why" in parseEdges(Array.from({ length: 101 }, (_, i) => i).join(",")));
  });
  test("generate: a size above 0 and a starting value", () => {
    assert.deepEqual(parseGenerate("7", "3"), { bins: { method: "generate", size: 7, anchor: 3 } });
    assert.deepEqual(parseGenerate("2.5", ""), { bins: { method: "generate", size: 2.5, anchor: 0 } });
    assert.ok("why" in parseGenerate("0", "1"));
    assert.ok("why" in parseGenerate("", "1"));
    assert.ok("why" in parseGenerate("5", "y"));
  });
  test("each method by name", () => {
    assert.equal(binMethodName({ method: "quartile" }), "quartiles");
    assert.equal(binMethodName({ method: "median" }), "a median split");
    assert.equal(binMethodName({ method: "generate", size: 5, anchor: 1 }), "bins of 5 from 1");
    assert.equal(binMethodName({ method: "custom", edges: [1] }), "custom edges");
  });
});

describe("what the menu keeps and sends", () => {
  test("a typed interval adds its ends to the chart's edges, as custom bins", () => {
    assert.deepEqual(binsAfterEdit({ showNa: true }, AGE, [42, 47.5]), { showNa: true, bins: { method: "custom", edges: [35, 40, 42, 45, 47.5, 50] } });
  });
  test("one-value bars take no bins", () => {
    assert.equal(oneValueBars([{ start: 1, end: 1, count: 2 }, { start: 2, end: 2, count: 1 }, { value: "NA", count: 1 }]), true);
    assert.equal(oneValueBars(AGE), false);
    assert.equal(oneValueBars([]), false);
  });
  test("the server is sent what changes the bars: Show NA stays in the browser, null (the default bars) is sent", () => {
    assert.deepEqual(serverBins({ AGE: { showNa: true }, MC: { disableLog: true }, MSI_SCORE: { bins: null }, FGA: { bins: { method: "median" }, showNa: true } }),
      { MC: { disableLog: true }, MSI_SCORE: { bins: null }, FGA: { bins: { method: "median" } } });
  });
});
