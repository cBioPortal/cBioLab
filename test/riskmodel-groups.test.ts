// The risk model's group step (lib/views/riskmodel.ts groupRiskmodel): how held-out scores become
// risk groups, from a fit alone. Synthetic fits, so each rule is checked on numbers it can be read off.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { groupRiskmodel as groupAt, groupQuantiles, riskFitSpec, riskModelView, RISK_PRESENTATION_KEYS, type RiskFit } from "../lib/views/riskmodel.ts";
import type { RiskmodelView } from "../lib/types.ts";
import { cutLandsAt } from "../lib/figures/riskmodel.ts";

/** A fit over these held-out scores (null: never held out): survival times 1…n, every third an event. */
function fitOf(heldOut: (number | null)[], o: { validation?: number[]; external?: (number | null)[] } = {}): RiskFit {
  const n = heldOut.length;
  const validation = o.validation ?? [];
  const inVal = new Set(validation);
  return {
    queries: [], rowsReturned: n, n, events: 0, notProfiled: 0, noStratum: 0, noCovariate: 0, noAnchor: 0, anchorAfterStart: 0, noFollowUp: 0,
    genesCovered: 1, candidates: 1, strataLevels: 1, anchored: false, validated: validation.length > 0,
    subjects: { time: heldOut.map((_, i) => i + 1), entry: heldOut.map(() => 0), event: heldOut.map((_, i) => (i % 3 === 0 ? 1 : 0)), stratum: heldOut.map(() => 0) },
    pool: heldOut.map((_, i) => i).filter((i) => !inVal.has(i)), validation,
    heldOut: heldOut.map((v, i) => inVal.has(i) ? null : v), external: o.external ?? heldOut.map(() => null),
    cIndexRuns: [0.6], validationCIndex: null, features: [], covariates: [],
  };
}
/** `n` equal groups, as a view with `groups: n` asks */
const groupRiskmodel = (fit: RiskFit, n: number) => groupAt(fit, groupQuantiles({ groups: n }));
const sizes = (g: ReturnType<typeof groupAt>) => g.groups.map((x) => x.curve.n);

describe("risk groups from held-out scores", () => {
  test("distinct scores: equal quantiles make equal groups, and each group spans its cuts", () => {
    const g = groupRiskmodel(fitOf(Array.from({ length: 90 }, (_, i) => i / 10)), 3);
    assert.deepEqual(sizes(g), [30, 30, 30]);
    assert.deepEqual(g.groups.map((x) => x.name), ["Low risk", "Intermediate risk", "High risk"]);
    assert.equal(g.groups[0].from, null);
    assert.equal(g.groups[0].to, g.groups[1].from);
    assert.equal(g.groups[2].to, null);
    assert.equal(g.groupsMade, 3);
    assert.equal(g.groups[0].hr, null, "the lowest group is the reference");
    assert.ok(g.groups[1].hr != null && g.groups[2].hr != null);
  });

  test("tied scores stay in one group, and groups the ties cannot fill merge", () => {
    // 60 patients on two scores: three groups are asked for, two can be made
    const g = groupRiskmodel(fitOf([...Array(40).fill(1), ...Array(20).fill(2)]), 3);
    assert.equal(g.groupsMade, 2);
    assert.equal(g.distinct, 2);
    assert.deepEqual(sizes(g), [40, 20]);
    assert.deepEqual(g.groups.map((x) => x.name), ["Low risk", "High risk"]);
  });

  test("a patient never held out is in no group, and counted", () => {
    const g = groupRiskmodel(fitOf([...Array.from({ length: 60 }, (_, i) => i), null, null]), 2);
    assert.equal(g.neverHeldOut, 2);
    assert.equal(sizes(g).reduce((a, b) => a + b, 0), 60);
  });

  test("the 0–10 scale is anchored at the lowest and highest held-out score", () => {
    const g = groupRiskmodel(fitOf(Array.from({ length: 60 }, (_, i) => -1 + i / 20)), 3);
    assert.equal(g.scale.min, -1);
    assert.equal(g.scale.max, -1 + 59 / 20);
  });

  test("the score at each percentile is the rank a cut there starts from", () => {
    const g = groupRiskmodel(fitOf(Array.from({ length: 200 }, (_, i) => i)), 3);
    assert.equal(g.percentiles.length, 101);
    assert.equal(g.percentiles[0], 0);
    assert.equal(g.percentiles[80], 160);
    assert.equal(g.percentiles[100], 199);
    assert.ok(g.percentiles.every((v, k) => k === 0 || v >= g.percentiles[k - 1]));
  });

  test("cuts a view names: the top fifth against the rest, and three groups at chosen quantiles", () => {
    const fit = fitOf(Array.from({ length: 100 }, (_, i) => i));
    assert.deepEqual(sizes(groupAt(fit, groupQuantiles({ cuts: [0.8] }))), [80, 20]);
    assert.deepEqual(sizes(groupAt(fit, groupQuantiles({ cuts: [0.1, 0.5] }))), [10, 40, 50]);
  });

  test("equal groups are the quantiles k/n, as written out", () => {
    assert.deepEqual(groupQuantiles({ groups: 4 }), [0.25, 0.5, 0.75]);
    const fit = fitOf(Array.from({ length: 90 }, (_, i) => i / 10));
    assert.deepEqual(groupAt(fit, groupQuantiles({ groups: 3 })), groupAt(fit, [1 / 3, 2 / 3]));
  });

  test("a chosen cut inside a run of ties moves to its nearer edge, so equal scores share a group", () => {
    // 50 patients score 0, 30 score 1, 20 score 2: a cut at the 60th percentile falls inside the 1s
    const g = groupAt(fitOf([...Array(50).fill(0), ...Array(30).fill(1), ...Array(20).fill(2)]), [0.6]);
    assert.deepEqual(sizes(g), [50, 50]);
  });

  test("the dialog's preview of a cut among ties lands where the engine puts it, to a percentile", () => {
    // 1,000 patients: a fifth of them tied on one score in the middle, the rest distinct
    const scores = Array.from({ length: 1000 }, (_, i) => i >= 300 && i < 500 ? 300 : i);
    const fit = fitOf(scores);
    const pcts = groupAt(fit, [0.5]).percentiles;
    for (const p of [10, 31, 35, 39, 41, 45, 49, 60]) {
      const engine = groupAt(fit, [p / 100]).groups[0].curve.n / 10;
      assert.ok(Math.abs(cutLandsAt(pcts, p) - engine) <= 1, "cut at " + p + "%: preview " + cutLandsAt(pcts, p) + "%, engine " + engine + "%");
    }
    assert.equal(cutLandsAt(pcts, 35), 30, "nearer the run's start: before it");
    assert.equal(cutLandsAt(pcts, 45), 50, "nearer its end: after it");
  });

  test("with validation, the cuts come from the discovery half and the groups are the validation half's", () => {
    // discovery patients 0–59 hold scores 0…59; validation patients 60–89 all score above the top cut
    const held = [...Array.from({ length: 60 }, (_, i) => i), ...Array(30).fill(0)];
    const validation = Array.from({ length: 30 }, (_, k) => 60 + k);
    const external = held.map((_, i) => i >= 60 ? 100 + i : null);
    const g = groupRiskmodel(fitOf(held, { validation, external }), 3);
    assert.deepEqual(sizes(g), [0, 0, 30], "every validation patient lands above the discovery half's upper cut");
    assert.equal(g.scale.min, 0, "the scale is the discovery half's");
    assert.equal(g.scale.max, 59);
    assert.ok(g.histogram.edges[0] >= 160, "the histogram is of the reported (validation) scores");
  });
});

// The fit's cache key (lib/next-cache.ts cachedRiskFit) is its arguments, RiskFitArgs, whose view
// part is riskModelView: the whole view but for RISK_PRESENTATION_KEYS. The key must fail safe — a
// setting nobody listed is in it, so the worst a forgotten setting can do is refit needlessly — and
// the settings left out must truly not decide the model.
describe("the fit's cache key", () => {
  const base: RiskmodelView = { kind: "riskmodel", cohorts: ["A"], endpoint: "OS", measure: "any", minMutated: 30, strata: "CANCER_TYPE",
    covariates: ["AGE"], anchor: { eventType: "Treatment" }, validate: false, alpha: 0.5, runs: 10, seed: 1, groups: 3, labelAbove: 0.5, note: "n" };
  const key = (v: RiskmodelView) => JSON.stringify(riskModelView(v));

  test("a setting nobody listed is in it: a new view option refits rather than reusing a fit", () => {
    assert.notEqual(key({ ...base, someFutureOption: 1 } as RiskmodelView), key(base));
  });

  test("every setting of the model is in it", () => {
    const changes: Partial<RiskmodelView>[] = [{ endpoint: "PFS" }, { monthsAttribute: "M", statusAttribute: "S" }, { measure: "driver" },
      { minMutated: 40 }, { strata: "SEX" }, { strata: undefined }, { covariates: ["AGE", "STAGE"] }, { covariates: [] },
      { anchor: { eventType: "Surgery" } }, { anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" } }, { anchor: { eventType: "Treatment", occurrence: "LAST" } },
      { anchor: undefined }, { validate: true }, { alpha: 1 }, { runs: 20 }, { seed: 2 }];
    for (const change of changes) assert.notEqual(key({ ...base, ...change }), key(base), JSON.stringify(change));
  });

  test("the settings left out only cut and draw the groups: the model's settings do not read them", () => {
    for (const k of RISK_PRESENTATION_KEYS) {
      const changed = { ...base, [k]: k === "cohorts" ? ["B"] : k === "cuts" ? [0.8] : k === "note" ? "other" : k === "labelAbove" ? 0.9 : 5 } as RiskmodelView;
      assert.equal(key(changed), key(base), k + " is left out of the key");
      assert.deepEqual(riskFitSpec(changed, "v7"), riskFitSpec(base, "v7"), k + " must not change what the fit reads");
    }
  });

  test("the fit reads nothing of the view that the key leaves out", () => {
    assert.deepEqual(riskFitSpec(riskModelView(base), "v7"), riskFitSpec(base, "v7"));
  });

  test("the order a document writes its settings in does not matter", () => {
    const reversed = Object.fromEntries(Object.entries(base).reverse()) as RiskmodelView;
    assert.equal(key(reversed), key(base));
  });
});
