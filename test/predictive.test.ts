// The predictive view's per-gene fit: the two contrasts and the interaction are one model's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPredictiveGene } from "../lib/views/predictive/run.ts";
import { seededRandom } from "../lib/stats.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { ViewResult } from "../lib/types.ts";

test("HR among the exposed = HR among the unexposed × the interaction HR, and a planted interaction is found", () => {
  const rand = seededRandom(7);
  const rows = Array.from({ length: 600 }, (_, i) => {
    const exposed = i % 2 === 0, mutated = i % 3 === 0;
    // mutation harmful only when exposed: hazard ×3
    const rate = 0.1 * (mutated && exposed ? 3 : 1);
    const t = -Math.log(1 - rand()) / rate;
    return { t: Math.min(t, 20), ev: t < 20 ? 1 : 0, exposed, mutated, x: [] };
  });
  const f = fitPredictiveGene(rows);
  assert.ok(Math.abs(Math.log(f.inExposed.hr) - Math.log(f.inUnexposed.hr) - Math.log(f.interaction.hr)) < 1e-6);
  assert.ok(f.inExposed.hr > 2 && f.inExposed.hr < 4.5, "exposed HR " + f.inExposed.hr);
  assert.ok(f.inUnexposed.hr > 0.6 && f.inUnexposed.hr < 1.6, "unexposed HR " + f.inUnexposed.hr);
  assert.ok(f.interaction.p < 1e-4);
});

test("the figure draws a skipped gene as a note and lints clean", () => {
  const e = { hr: 1.5, ciLow: 1.1, ciHigh: 2, p: 0.01 };
  const v = { kind: "predictive", cohorts: ["NSCLC"], caveat: "immortal time",
    predictive: { exposure: "Treatment [SUBTYPE=Immuno]", endpoint: "OS", measure: "any", n: 100, exposed: 40, events: 50, notProfiled: 0, noCovariate: 0, covariates: [], minMutated: 5, strata: 1,
      genes: [{ gene: "STK11", exposed: 40, unexposed: 60, mutatedExposed: 8, mutatedUnexposed: 9, events: 50, inExposed: e, inUnexposed: { ...e, hr: 0.9, ciLow: 0.5, ciHigh: 1.6 }, interaction: e, q: 0.02 },
        { gene: "EGFR", exposed: 40, unexposed: 60, mutatedExposed: 2, mutatedUnexposed: 9, events: 50, inExposed: null, inUnexposed: null, interaction: null, q: null, skipped: "too few mutated" }] } } as ViewResult;
  for (const width of [560, 936]) {
    const svg = viewToSvg(v, { width })!;
    assert.match(svg, /not fitted: too few mutated/);
    assert.deepEqual(lintSvg(svg), []);
  }
});
