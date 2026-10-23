// The multistate view's statistics and figure: the illness–death estimators on a toy cohort, the
// Cox partial likelihood with delayed entry, and the drawing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { illnessDeath, coxPartialLogLik, coxRegression, type CoxRow } from "../lib/stats.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { ViewResult } from "../lib/types.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, a + " vs " + b);

describe("illnessDeath", () => {
  // A progresses at 1 and dies at 3; B dies at 2 without progressing; C is censored at 4; D progresses at 2, censored at 5
  const recs = [{ prevalent: false, tp: 1, te: 3, dead: true }, { prevalent: false, tp: null, te: 2, dead: true },
    { prevalent: false, tp: null, te: 4, dead: false }, { prevalent: false, tp: 2, te: 5, dead: false }];
  test("Nelson–Aalen by hand: 01 rises 1/4 then 1/3, 02 by 1/3, 12 by 1/2", () => {
    const f = illnessDeath(recs);
    assert.deepEqual(f.cumhaz["01"].map((q) => q.t), [0, 1, 2]);
    close(f.cumhaz["01"][2].h, 1 / 4 + 1 / 3);
    close(f.cumhaz["02"][1].h, 1 / 3);
    close(f.cumhaz["12"][1].h, 1 / 2);
    assert.deepEqual(f.events, { "01": 2, "02": 1, "12": 1, c0: 1, c1: 1 });
    assert.deepEqual(f.personTime, { s0: 1 + 2 + 4 + 2, s1: 2 + 3 });
  });
  test("Aalen–Johansen by hand, and equal to the empirical shares without censoring before t", () => {
    const o = illnessDeath(recs).occupation;
    assert.deepEqual(o.map((q) => q.t), [0, 1, 2, 3]);
    close(o[1].p0, 0.75); close(o[1].p1, 0.25);
    close(o[2].p0, 0.25); close(o[2].p1, 0.5); close(o[2].p2, 0.25);
    close(o[3].p0, 0.25); close(o[3].p1, 0.25); close(o[3].p2, 0.5);
  });
  test("a prevalent patient starts in the middle state and is at risk of death from 0", () => {
    const f = illnessDeath([{ prevalent: true, tp: null, te: 1, dead: true }, { prevalent: false, tp: null, te: 2, dead: false }]);
    close(f.occupation[0].p1, 0.5);
    close(f.cumhaz["12"][1].h, 1);
    close(f.occupation[1].p2, 0.5);
  });
});

describe("Cox with delayed entry", () => {
  const rows: CoxRow[] = [
    { t: 2, event: 1, x: [1] }, { t: 3, event: 1, x: [0], entry: 1 }, { t: 5, event: 0, x: [1], entry: 2.5 },
    { t: 6, event: 1, x: [0], entry: 4 }, { t: 7, event: 1, x: [1] }, { t: 8, event: 0, x: [0], entry: 6.5 }, { t: 4, event: 1, x: [0] },
  ];
  // the partial likelihood over risk sets {entry < t_i ≤ t_j}, written out
  const brute = (b: number) => rows.filter((r) => r.event).reduce((ll, r) => ll + b * r.x[0] -
    Math.log(rows.filter((j) => (j.entry ?? -Infinity) < r.t && j.t >= r.t).reduce((s, j) => s + Math.exp(b * j.x[0]), 0)), 0);
  for (const b of [-0.7, 0, 0.4]) test("partial log-likelihood at β = " + b + " matches the counting-process risk sets", () => close(coxPartialLogLik(rows, [b]), brute(b)));
  test("an entry before every event time changes nothing", () => {
    const plain = rows.map(({ t, event, x }) => ({ t, event, x }));
    const early = plain.map((r) => ({ ...r, entry: 0 }));
    close(coxRegression(early).beta[0], coxRegression(plain).beta[0]);
  });
});

describe("multistate figure", () => {
  const occ = [{ t: 0, p0: 0.8, p1: 0.2, p2: 0 }, { t: 3, p0: 0.6, p1: 0.3, p2: 0.1 }, { t: 12, p0: 0.3, p1: 0.4, p2: 0.3 }];
  const ch = [{ t: 0, h: 0, lo: 0, hi: 0 }, { t: 2, h: 0.1, lo: 0.05, hi: 0.2 }, { t: 10, h: 0.4, lo: 0.3, hi: 0.5 }];
  const cohort = (name: string) => ({ cohort: name, cohortPatients: 100, n: 90, prevalent: 18, excluded: { noFollowup: 10, prevalent: 0 },
    notAssessed: 3, afterEnd: 0, seq0: 90, late: 0, censored: { start: 20, progression: 10 },
    rates: (["01", "02", "12"] as const).map((key) => ({ key, events: 12, personMonths: 400, rate: 3, lo: 1.7, hi: 5.3 })),
    occupation: occ, cumhaz: { "01": ch, "02": ch, "12": ch }, drawnTo: 14,
    atHorizon: [{ months: 12, p0: 0.3, p1: 0.4, p2: 0.3, atRisk: 20 }, { months: 60, p0: null, p1: null, p2: null, atRisk: 2 }] });
  const v = { kind: "multistate", cohorts: ["A <x>", "B"], caveat: "not randomised",
    multistate: { progression: { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y"] }, prevalent: "include", horizons: [12, 60], tMax: 14,
      origin: "first sequencing", cohorts: [cohort("A <x>"), cohort("B")], reference: "A <x>",
      cox: [{ key: "01", rows: [{ cohort: "B", hr: 1.4, lo: 1.1, hi: 1.9, p: 0.004 }], n: 160, events: 24 },
        { key: "02", rows: [], n: 160, events: 24, noFit: "B has fewer than 5 events" }, { key: "12", rows: [{ cohort: "B", hr: 0.8, lo: 0.5, hi: 1.2, p: 0.3 }], n: 50, events: 24 }] } } as ViewResult;
  for (const width of [560, 936]) test("draws, escapes names and lints clean at " + width, () => {
    const svg = viewToSvg(v, { width })!;
    assert.match(svg, /A &lt;x&gt;/);
    assert.match(svg, /progression → death/);
    assert.deepEqual(lintSvg(svg), []);
  });
});
