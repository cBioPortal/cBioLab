// A study-view bar chart's words as cbioportal.org writes them (lib/chart/format.ts): the tooltip's
// range (`formatRange`, STS-BAR-4) and a log-scale tick (`formatNumericalTickValues`, STS-BAR-3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalBinRange, portalLogTick } from "../lib/chart/format.ts";

test("STS-BAR-4: a bar's range as the portal's tooltip writes it", () => {
  const cases: [Parameters<typeof portalBinRange>[0], string][] = [
    [{ start: 20, end: 25 }, "(20, 25]"],                       // an interval
    [{ start: 60, end: 80 }, "(60, 80]"],                       // seen: "Range: (60, 80]"
    [{ start: 1000, end: 2500 }, "(1,000, 2,500]"],             // toLocaleString
    [{ start: 0.05, end: 0.1 }, "(0.05, 0.1]"],
    [{ end: 18, special: "<=" }, "≤18"],                        // the outlier bars
    [{ start: 90, special: ">" }, ">90"],
    [{ start: 20, end: 25, special: "<=" }, "≤20-25"],          // a special value with both ends
    [{ start: 5, end: 5 }, "5"],                                // one value
    [{ value: "NA" }, "NA"], [{ value: "Negative" }, "Negative"],
  ];
  for (const [b, want] of cases) assert.equal(portalBinRange(b), want, JSON.stringify(b));
});

test("STS-BAR-3: a log-scale tick: 10ⁿ, half steps blank, ±1, ±10 and 0 as themselves", () => {
  const cases: [number, string][] = [
    [-100000, "−10⁵"], [-10000, "−10⁴"],                        // seen on DAYS_TO_BIRTH
    [-31623, ""], [316, ""],                                     // half-exponent ticks are blank
    [100, "10²"], [1000, "10³"], [1e6, "10⁶"],
    [-10, "−10"], [-1, "−1"], [0, "0"], [1, "1"], [10, "10"],
  ];
  for (const [v, want] of cases) assert.equal(portalLogTick(v), want, String(v));
});
