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
  test("with no declared reference, a mutated-vs-not covariate always defaults to 'Not mutated' — not frequency", () => {
    // 7 "Mutated", 3 "Not mutated" — Mutated is more frequent, but the reference is still
    // "Not mutated": for a mutated/not axis, frequency isn't a sound tie-breaker (a gene
    // altered in most patients would otherwise silently flip which side of the HR is "risk"
    // relative to a gene altered in few), so this one axis kind gets a fixed convention instead.
    const r = rows([
      ...Array.from({ length: 7 }, () => ["Mutated"]),
      ...Array.from({ length: 3 }, () => ["Not mutated"]),
    ]);
    const cols = buildCoxColumns([mutatedCov], ["cat"] as AxisKind[], r);
    assert.equal(cols.length, 1);
    assert.equal(cols[0].reference, "Not mutated");
    assert.equal(cols[0].level, "Mutated");
  });

  test("mutationType/cna axes are unaffected — only a plain mutated-vs-not axis gets the fixed default", () => {
    // by:"mutationType" also produces a "Not mutated" level, but this covariate isn't asking
    // a binary mutated/not question, so it stays on the frequency default like any other
    // multi-level categorical.
    const cov: CoxCovariate = { source: "alteration", gene: "APC", by: "mutationType" };
    const r = rows([
      ["Truncating"], ["Truncating"], ["Truncating"], ["Truncating"], ["Truncating"],
      ["Not mutated"], ["Not mutated"], ["Not mutated"],
    ]);
    const cols = buildCoxColumns([cov], ["cat"] as AxisKind[], r);
    assert.ok(cols.every((c) => c.reference === "Truncating"));
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
    assert.equal(cols[0].reference, "Not mutated"); // falls back to the same default as no declaration at all
  });

  test("a declared reference that was never observed, on a non-mutated-axis covariate, falls back to frequency", () => {
    const cov: CoxCovariate = { source: "clinical", attribute: "APC_GROUPS", reference: "Not a real level" };
    const r = rows([["N-terminal"], ["N-terminal"], ["C-terminal"]]);
    const cols = buildCoxColumns([cov], ["cat"] as AxisKind[], r);
    assert.equal(cols[0].reference, "N-terminal"); // no implicit default applies here — frequency wins
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
