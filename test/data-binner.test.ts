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
import { dataBins } from "../lib/data-binner.ts";

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
