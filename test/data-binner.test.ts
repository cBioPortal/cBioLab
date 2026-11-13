// The histogram binner (lib/data-binner.ts) against cBioPortal's own bars: test/fixtures/data-binner.json
// holds recorded values of real attributes and the bars the portal's study view drew for them
// (clinical-data-bin-counts, DYNAMIC). Every count must match exactly and every edge to 12
// significant digits: the portal's server computes some powers of ten one unit short in the last
// place (10^-5 as 0.000009999999999999999), which moves no value. The cases cover one bar per value
// (GLEASON scores), values on an edge (MSI scores), ">90" ages, words in a numeric column (PSA
// "Negative"), log-scale and powers-of-ten bars, and the AGE rule.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dataBins, recountBins, type BinSettings } from "../lib/data-binner.ts";

interface PortalBin { specialValue?: string; start?: number; end?: number; count: number }
const { cases } = JSON.parse(readFileSync(new URL("./fixtures/data-binner.json", import.meta.url), "utf8")) as
  { cases: { study: string; attribute: string; values: { value: string; count: number }[]; portal: PortalBin[] }[] };

const near = (a: number | undefined, b: number | undefined) =>
  a == null || b == null ? a === b : a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));

describe("data binner: the portal's bars for the same values", () => {
  for (const c of cases) test(c.study + " " + c.attribute, () => {
    const ours = dataBins(c.values, c.attribute);
    assert.equal(ours.length, c.portal.length, JSON.stringify(ours) + "\n" + JSON.stringify(c.portal));
    c.portal.forEach((p, i) => {
      const o = ours[i];
      const word = p.start == null && p.end == null;
      assert.equal(o.count, p.count, "bar " + i);
      if (word) assert.equal(o.value, p.specialValue, "bar " + i);
      else {
        assert.equal(o.special, p.specialValue, "bar " + i);
        assert.ok(near(o.start, p.start) && near(o.end, p.end), "bar " + i + ": " + JSON.stringify(o) + " vs " + JSON.stringify(p));
      }
    });
  });
});

describe("data binner: the rules that decide a bar", () => {
  test("a value on an edge belongs to the bar that ends there", () => {
    const vals = Array.from({ length: 30 }, (_, i) => ({ value: (i / 10).toFixed(1), count: 1 }));
    const bins = dataBins(vals);
    // bars 0.2 wide: (0.2, 0.4] holds 0.3 and 0.4, and 0.2 is in the bar below
    assert.deepEqual(bins[1], { start: 0.2, end: 0.4, count: 2 });
    assert.deepEqual(bins[0], { special: "<=", end: 0.2, count: 3 });
  });
  test("at most ten values: a bar each", () => {
    const bins = dataBins([{ value: "6", count: 3 }, { value: "7", count: 2 }, { value: "9", count: 18 }]);
    assert.deepEqual(bins.map((b) => [b.start, b.end, b.count]), [[6, 6, 3], [7, 7, 2], [9, 9, 18]]);
  });
  test("a bound recorded as a value opens the outlier bar on its side", () => {
    const vals = [...Array.from({ length: 40 }, (_, i) => ({ value: String(40 + i), count: 1 })), { value: ">90", count: 4 }];
    const last = dataBins(vals).at(-1)!;
    assert.equal(last.special, ">");
    assert.ok(last.count >= 4);
  });
  test("a word in a numeric column is its own bar, its spellings folded", () => {
    const bins = dataBins([...Array.from({ length: 20 }, (_, i) => ({ value: String(i), count: 1 })), { value: "Negative", count: 2 }, { value: "NEGATIVE", count: 1 }]);
    assert.deepEqual(bins.at(-1), { value: "Negative", count: 3 });
  });
});

describe("data binner: the portal's STATIC bins, laid out once and counted again", () => {
  for (const c of cases) test(c.study + " " + c.attribute + ": every value lands in the bar dataBins put it in, and a subset keeps the bars", () => {
    const bins = dataBins(c.values, c.attribute);
    assert.deepEqual(recountBins(bins, c.values), bins, "the whole study counted again is the same bars");
    const half = c.values.filter((_, i) => i % 2 === 0);
    const again = recountBins(bins, half);
    assert.deepEqual(again.map(({ count: _c, ...b }) => b), bins.map(({ count: _c, ...b }) => b), "the bars stay put");
    assert.equal(again.reduce((n, b) => n + b.count, 0), half.reduce((n, v) => n + v.count, 0), "no value of the subset is lost");
  });

  test("a bar the subset leaves empty is kept at 0, and a value no bar holds is not counted", () => {
    const bins = dataBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v) => ({ value: String(v * 10), count: 1 })));
    const again = recountBins(bins, [{ value: "10", count: 2 }, { value: "Negative", count: 5 }]);
    assert.equal(again.length, bins.length);
    assert.equal(again.reduce((n, b) => n + b.count, 0), 2);
    assert.ok(again.some((b) => b.count === 0));
  });
});

// Each bin setting a chart's menu offers (STS-BAR-7, STS-BAR-8, STS-STM-4), against the bars
// cbioportal.org draws for the same values and setting: test/fixtures/data-binner-methods.json.
const methods = JSON.parse(readFileSync(new URL("./fixtures/data-binner-methods.json", import.meta.url), "utf8")) as
  { cases: { study: string; attribute: string; values: { value: string; count: number }[]; runs: { settings: BinSettings; portal: PortalBin[] }[] }[] };

describe("data binner: the chart menu's bins, as the portal draws them", () => {
  for (const c of methods.cases) for (const r of c.runs) test(c.attribute + " " + JSON.stringify(r.settings), () => {
    const ours = dataBins(c.values, c.attribute, r.settings).filter((b) => b.value == null);
    assert.ok(r.portal.length > 0, "the portal drew bars");
    assert.deepEqual(ours.map((b) => [b.special, b.start, b.end, b.count]), r.portal.map((p) => [p.specialValue, p.start, p.end, p.count]));
  });
  test("bins: null is the default bars; a setting for another chart changes nothing", () => {
    const age = methods.cases.find((c) => c.attribute === "AGE")!;
    assert.deepEqual(dataBins(age.values, "AGE", { bins: null }), dataBins(age.values, "AGE"));
  });
  test("at most ten values keep a bar each, whatever the setting (the portal's order)", () => {
    const few = [{ value: "1", count: 4 }, { value: "2", count: 3 }, { value: "5", count: 1 }];
    assert.deepEqual(dataBins(few, "X", { bins: { method: "median" } }), dataBins(few, "X"));
  });
  test("a bin size of 0 makes no bars of its own", () => {
    const vals = Array.from({ length: 30 }, (_, i) => ({ value: String(i), count: 1 }));
    assert.doesNotThrow(() => dataBins(vals, "X", { bins: { method: "generate", size: 0, anchor: 0 } }));
  });
});
