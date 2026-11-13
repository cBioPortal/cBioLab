// The cut-point view's scan: it finds a planted threshold, corrects for the search, and agrees
// with the ordinary log-rank test at the cut it picks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCutpoints, CUT_MAX_CANDIDATES, type CutRec } from "../lib/views/cutpoint/run.ts";
import { seededRandom } from "../lib/stats.ts";
import { kindText } from "./support/kind-text.ts";
import { cutpointKind } from "../lib/views/cutpoint/kind.ts";

const cohort = (n: number, hazard: (v: number) => number, seed: number): CutRec[] => {
  const rand = seededRandom(seed);
  return Array.from({ length: n }, (_, i) => {
    const v = i % 50;
    const t = -Math.log(1 - rand()) / hazard(v);
    return { v, t: Math.min(t, 30), ev: t < 30 ? 1 : 0 };
  });
};

test("a planted threshold at 30 is found, and its corrected p is small", () => {
  const s = scanCutpoints(cohort(800, (v) => v > 30 ? 0.2 : 0.05, 3), 300, 1)!;
  assert.ok(s.cut >= 28 && s.cut <= 32, "cut " + s.cut);
  assert.ok(s.permP < 0.01);
  assert.ok(s.hr!.hr > 2);
});

test("under a modest effect the standardized score statistic is the log-rank chi-squared at the cut, up to its variance estimate", () => {
  const s = scanCutpoints(cohort(800, (v) => v > 30 ? 0.075 : 0.05, 4), 200, 1)!;
  assert.ok(Math.abs(s.maxStat - s.naiveChi2) / s.naiveChi2 < 0.1, s.maxStat + " vs " + s.naiveChi2);
});

test("without an effect the best cut is not significant once the search is corrected for", () => {
  const s = scanCutpoints(cohort(800, () => 0.1, 5), 300, 1)!;
  assert.ok(s.permP > 0.05, "permP " + s.permP);
  assert.ok(s.permP >= s.naiveP, "the corrected p is never below the naive one here");
});

test("candidates stay inside the 10th–90th percentile window and under the cap; seeded", () => {
  const recs = Array.from({ length: 1000 }, (_, i) => ({ v: i, t: (i * 7919) % 97 + 1, ev: i % 3 ? 1 : 0 }));
  const a = scanCutpoints(recs, 200, 9)!, b = scanCutpoints(recs, 200, 9)!;
  assert.equal(a.candidates.length, CUT_MAX_CANDIDATES);
  assert.ok(a.candidates.every((c) => c.cut >= 99 && c.cut <= 899));
  assert.equal(a.permP, b.permP);
});

test("too few patients, or one value, is no scan", () => {
  assert.equal(scanCutpoints(cohort(10, () => 0.1, 1), 100, 1), null);
  assert.equal(scanCutpoints(Array.from({ length: 50 }, (_, i) => ({ v: 1, t: i + 1, ev: 1 })), 100, 1), null);
});

test("a side whose median is never reached, and no hazard ratio overall or in a stratum", () => {
  const [t] = kindText(cutpointKind, { cutpoint: { attribute: "TMB", endpoint: "OS", candidates: [1, 2], n: 100, events: 40, cut: 10,
    high: { n: 30, events: 5, median: null }, low: { n: 70, events: 35, median: 20 }, hr: null, permP: 0.2, permutations: 1000, seed: 1, naiveP: 0.01,
    strata: { attribute: "SEX", rows: [{ stratum: "F", n: 50, cut: 9, high: { n: 10 }, hr: null, permP: 0.5, naiveP: 0.1 }] } } });
  assert.ok(t.includes("high n=30, 5 events, median not reached; low n=70, 35 events, median 20 mo\n"), "no HR after the sides: " + t);
  assert.ok(t.includes("F: n=50, cut 9, high 10, corrected p=0.5"), t);
});
