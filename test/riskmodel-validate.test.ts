// External validation of a risk model: scored with the ensemble's mean coefficients, cut at the
// training thresholds, and a patient not covered for a model gene left out, never wild-type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { riskExternal } from "../lib/views/riskmodel/validate.ts";
import type { RiskFit, RiskGrouping, RiskFitArgs, RiskResolver } from "../lib/views/riskmodel/run.ts";

test("scores by selected × mean coefficient, cuts at the training threshold, leaves the uncovered out", async () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => ({ m: 5 + (i % 7), ev: 1, half: 0, panels: ["P"], genes: ["A"] })),
    ...Array.from({ length: 40 }, (_, i) => ({ m: 20 + (i % 9), ev: i % 2, half: 0, panels: ["P"], genes: [] })),
    { m: 3, ev: 1, half: 0, panels: ["Q"], genes: [] },
  ];
  const r = { queries: [] as { label: string; sql: string }[],
    viewRows: async () => rows, viewMeta: async () => [{ panel: "P", genes: ["A", "B"] }, { panel: "Q", genes: ["B"] }] } as unknown as RiskResolver;
  const fit = { anchored: false, features: [{ gene: "A", selected: 0.5, meanCoef: 1, hr: Math.E, mutated: 10 }, { gene: "B", selected: 0, meanCoef: 0, hr: 1, mutated: 0 }] } as unknown as RiskFit;
  const g = { groups: [{ name: "Low risk", from: null }, { name: "High risk", from: 0.2 }] } as unknown as RiskGrouping;
  const args = { study: "s", def: { all: [] }, compile: { oncokbPin: null, profiles: [], gaProfiles: [] }, view: { kind: "riskmodel" } } as unknown as RiskFitArgs;
  const { external: e } = await riskExternal(r, args, "V", fit, g, 1);
  assert.equal(e.notCovered, 1);
  assert.equal(e.modelGenes, 1);
  assert.equal(e.n, 80);
  assert.deepEqual(e.groups.map((x) => x.curve.n), [40, 40]);
  assert.ok(e.cIndex > 0.8, "the mutated die first: " + e.cIndex);
  assert.ok(e.cIndexLo <= e.cIndex && e.cIndex <= e.cIndexHi);
  assert.ok(e.groups[1].hr! > 1);
});
