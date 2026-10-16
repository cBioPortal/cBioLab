// The risk model's group step (lib/views/riskmodel.ts groupRiskmodel): how held-out scores become
// risk groups, from a fit alone. Synthetic fits, so each rule is checked on numbers it can be read off.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { groupRiskmodel, riskFitSpec, type RiskFit } from "../lib/views/riskmodel.ts";
import type { RiskmodelView } from "../lib/types.ts";

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
const sizes = (g: ReturnType<typeof groupRiskmodel>) => g.groups.map((x) => x.curve.n);

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

// The fit's cache key (lib/next-cache.ts cachedRiskFit) is RiskFitArgs: the study, the resolved
// cohort definition and its compile context, and riskFitSpec — tested here. A setting that changes
// the model must change the spec, or a cached fit is served for a different model; one that only
// changes the groups or the drawing must not, or every such change refits.
describe("the fit's settings, as its cache key", () => {
  const base: RiskmodelView = { kind: "riskmodel", cohorts: ["A"], endpoint: "OS", measure: "any", minMutated: 30, strata: "CANCER_TYPE",
    covariates: ["AGE"], anchor: { eventType: "Treatment" }, validate: false, alpha: 0.5, runs: 10, seed: 1, groups: 3, labelAbove: 0.5 };
  const key = (v: RiskmodelView, pin: string | null = "v7") => JSON.stringify(riskFitSpec(v, pin));

  test("the groups, the label threshold and the note are not part of it", () => {
    for (const change of [{ groups: 5 }, { labelAbove: 0.9 }, { note: "a note" }, { cohorts: ["B"] }] as Partial<RiskmodelView>[])
      assert.equal(key({ ...base, ...change }), key(base), JSON.stringify(change));
  });

  test("every setting of the model is", () => {
    const changes: Partial<RiskmodelView>[] = [{ endpoint: "PFS" }, { monthsAttribute: "M", statusAttribute: "S" }, { measure: "driver" },
      { minMutated: 40 }, { strata: "SEX" }, { strata: undefined }, { covariates: ["AGE", "STAGE"] }, { covariates: [] },
      { anchor: { eventType: "Surgery" } }, { anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" } }, { anchor: { eventType: "Treatment", occurrence: "LAST" } },
      { anchor: undefined }, { validate: true }, { alpha: 1 }, { runs: 20 }, { seed: 2 }];
    for (const change of changes) assert.notEqual(key({ ...base, ...change }), key(base), JSON.stringify(change));
  });

  test("the OncoKB pin decides a driver model, and not one of any mutation", () => {
    assert.notEqual(key({ ...base, measure: "driver" }, "v7"), key({ ...base, measure: "driver" }, "v8"));
    assert.equal(key(base, "v7"), key(base, "v8"));
  });

  test("defaults are applied, so writing one out does not change it", () => {
    const bare: RiskmodelView = { kind: "riskmodel", cohorts: ["A"] };
    assert.equal(key(bare), key({ ...bare, endpoint: "os", measure: "any", minMutated: 30, alpha: 0.5, runs: 10, seed: 1, validate: false }));
  });
});
