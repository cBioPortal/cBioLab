// Cox covariate dummy-coding: which level becomes the reference, and why it matters —
// a hazard ratio's direction depends entirely on it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCoxColumns } from "../lib/analysis.ts";
import type { CoxCovariate } from "../lib/types.ts";
import type { AxisKind } from "../lib/plot.ts";

const mutatedCov: CoxCovariate = { source: "alteration", gene: "APC", by: "mutated" };
const rows = (values: (number | string)[][]) => values.map((v) => ({ values: v }));

describe("buildCoxColumns: reference level", () => {
  test("with no declared reference, the most frequent level is the reference (existing behavior)", () => {
    // 7 "Mutated", 3 "Not mutated" — Mutated is more frequent, so it's the reference by
    // default, and the fit column is "Not mutated" vs it (HR reads mutated-relative-to-that).
    const r = rows([
      ...Array.from({ length: 7 }, () => ["Mutated"]),
      ...Array.from({ length: 3 }, () => ["Not mutated"]),
    ]);
    const cols = buildCoxColumns([mutatedCov], ["cat"] as AxisKind[], r);
    assert.equal(cols.length, 1);
    assert.equal(cols[0].reference, "Mutated");
    assert.equal(cols[0].level, "Not mutated");
  });

  test("a declared reference overrides frequency — the paper's actual complaint", () => {
    // Same 7/3 split, but the covariate asks for "Mutated" to be compared AGAINST
    // "Not mutated" (i.e. "Not mutated" as reference) regardless of which is more common —
    // this is what flips a paper's HR 1.48 "not-mutated vs mutated" into 0.68 "mutated
    // vs not-mutated" without hand-inverting the number afterward.
    const cov: CoxCovariate = { ...mutatedCov, reference: "Not mutated" };
    const r = rows([
      ...Array.from({ length: 7 }, () => ["Mutated"]),
      ...Array.from({ length: 3 }, () => ["Not mutated"]),
    ]);
    const cols = buildCoxColumns([cov], ["cat"] as AxisKind[], r);
    assert.equal(cols[0].reference, "Not mutated");
    assert.equal(cols[0].level, "Mutated");
  });

  test("a declared reference that was never observed is ignored, not silently matching nothing", () => {
    const cov: CoxCovariate = { ...mutatedCov, reference: "Amplified" }; // not a level this covariate ever produces
    const r = rows([["Mutated"], ["Mutated"], ["Not mutated"]]);
    const cols = buildCoxColumns([cov], ["cat"] as AxisKind[], r);
    assert.equal(cols[0].reference, "Mutated"); // falls back to frequency, same as no declaration at all
  });

  test("a numeric covariate is untouched by any of this — one column, no reference", () => {
    const cov: CoxCovariate = { source: "clinical", attribute: "CURRENT_AGE_DEID" };
    const r = rows([[45], [62], [71]]);
    const cols = buildCoxColumns([cov], ["num"] as AxisKind[], r);
    assert.equal(cols.length, 1);
    assert.equal(cols[0].reference, undefined);
    assert.equal(cols[0].level, undefined);
  });

  test("three or more levels: the declared reference still goes first, the rest keep frequency order", () => {
    const cov: CoxCovariate = { source: "clinical", attribute: "APC_GROUPS", reference: "Wild-type" };
    const r = rows([
      ...Array.from({ length: 5 }, () => ["N-terminal"]),
      ...Array.from({ length: 3 }, () => ["C-terminal"]),
      ...Array.from({ length: 1 }, () => ["Wild-type"]),
    ]);
    const cols = buildCoxColumns([cov], ["cat"] as AxisKind[], r);
    assert.equal(cols.length, 2); // two non-reference levels
    assert.ok(cols.every((c) => c.reference === "Wild-type"));
    assert.deepEqual(cols.map((c) => c.level), ["N-terminal", "C-terminal"]); // by frequency among the rest
  });

  test("multiple covariates keep their own reference choices independent", () => {
    const covA: CoxCovariate = { source: "alteration", gene: "APC", by: "mutated", reference: "Not mutated" };
    const covB: CoxCovariate = { source: "clinical", attribute: "SEX" }; // no declared reference — frequency default
    const r = rows([
      ["Mutated", "Female"], ["Mutated", "Female"], ["Mutated", "Male"], ["Not mutated", "Female"],
    ]);
    const cols = buildCoxColumns([covA, covB], ["cat", "cat"] as AxisKind[], r);
    const apcCol = cols.find((c) => c.axisIndex === 0)!;
    const sexCol = cols.find((c) => c.axisIndex === 1)!;
    assert.equal(apcCol.reference, "Not mutated");
    assert.equal(sexCol.reference, "Female"); // more frequent than Male here
  });
});
