// The treatment-endpoints view's statistic and figure: the KM median's interval, and the drawing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { kmMedianCi } from "../lib/stats.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { ViewResult } from "../lib/types.ts";

describe("kmMedianCi", () => {
  test("ten events at 1..10 months: median 5, lower end 3, no upper end (R survfit, conf.type log, gives 3 and NA)", () => {
    const r = kmMedianCi(Array.from({ length: 10 }, (_, i) => ({ t: i + 1, event: 1 })));
    assert.deepEqual(r, { median: 5, lo: 3, hi: null });
  });
  test("a curve that never reaches one half has no median and no interval", () => {
    const r = kmMedianCi([{ t: 1, event: 1 }, ...Array.from({ length: 9 }, (_, i) => ({ t: i + 2, event: 0 }))]);
    assert.deepEqual(r, { median: null, lo: null, hi: null });
  });
  test("delayed entry: a patient not yet entered is not at risk", () => {
    const recs = [{ t: 1, event: 1 }, { t: 2, event: 1 }, { t: 5, event: 1, entry: 3 }, { t: 6, event: 0, entry: 3 }];
    assert.equal(kmMedianCi(recs).median, 1);
    assert.equal(kmMedianCi(recs.map(({ t, event }) => ({ t, event }))).median, 2);
  });
});

describe("txendpoints figure", () => {
  const curve = (cohort: string, k: number) => ({ cohort, points: [{ t: 0, s: 1 }, { t: 2, s: 0.6 }, { t: 5 + k, s: 0.3 }], median: 5 + k, medianLo: 2, medianHi: null,
    n: 40, events: 20, atRisk: [40, 35, 30, 20, 15, 10, 8, 5], cohortPatients: 100, anchored: 45, excluded: { noAnchor: 55, noFollowup: 5, noStop: 0 }, late: 0 });
  const v = { kind: "txendpoints", cohorts: ["A <x>", "B"], caveat: "not randomised",
    txendpoints: { endpoint: "ttnt", endpointLabel: "time to next treatment", anchoredTo: "first Treatment [SUBTYPE=Immuno]", lineGap: 90, lineClasses: "systemic",
      curves: [curve("A <x>", 0), curve("B", 1)], logrank: { chi2: 1.2, p: 0.27, df: 1, observed: [20, 20], expected: [18, 22], groups: 2, strata: 1 } } } as ViewResult;
  for (const width of [560, 936]) test("draws, escapes names and lints clean at " + width, () => {
    const svg = viewToSvg(v, { width })!;
    assert.match(svg, /A &lt;x&gt;/);
    assert.match(svg, /log-rank/);
    assert.deepEqual(lintSvg(svg), []);
  });
});
