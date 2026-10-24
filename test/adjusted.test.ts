// The adjusted view's per-gene fits, on fixed inputs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { adjustedFit, covariateKinds, type AdjustedPatient } from "../lib/views/adjusted/run.ts";

// cohort 1 is mostly MSI-high, and MSI-high tumours carry gene X: raw, X is enriched in cohort 1;
// adjusted for MSI, it is not
function patients(): AdjustedPatient[] {
  const out: AdjustedPatient[] = [];
  const add = (group: 0 | 1, msi: string, n: number, mutated: number, extra: Partial<AdjustedPatient> = {}) => {
    for (let i = 0; i < n; i++) out.push({ group, covers: null, genes: new Set(i < mutated ? ["X"] : []), values: [msi], ...extra });
  };
  add(1, "MSI-H", 60, 30); add(1, "MSS", 40, 4);
  add(0, "MSI-H", 20, 10); add(0, "MSS", 180, 18);
  return out;
}

describe("adjustedFit", () => {
  test("a confounded gene: raw odds ratio far from 1, adjusted near 1", () => {
    const pts = patients();
    const { rows, failed } = adjustedFit(pts, ["X"], ["MSI"], covariateKinds(pts, 1));
    assert.equal(failed.length, 0);
    const g = rows[0];
    assert.deepEqual(g.altered, [34, 28]); assert.deepEqual(g.profiled, [100, 200]);
    near(g.rawOr!, (34 * 172) / (66 * 28));
    assert.ok(g.fisherP < 1e-3, "raw p " + g.fisherP);
    near(g.or, 1, 1e-6);
  });
  test("a patient whose panels do not cover the gene is left out of it, never wild type", () => {
    const pts = [...patients(), ...Array.from({ length: 50 }, () => ({ group: 1 as const, covers: new Set(["Y"]), genes: new Set<string>(), values: ["MSS"] }))];
    const { rows } = adjustedFit(pts, ["X"], ["MSI"], covariateKinds(pts, 1));
    assert.deepEqual(rows[0].profiled, [100, 200]);
  });
  test("a gene mutated in no patient of one cohort cannot be fit and is listed", () => {
    const pts = patients().map((r) => r.group === 0 ? { ...r, genes: new Set<string>() } : r);
    const { rows, failed } = adjustedFit(pts, ["X"], [], []);
    assert.equal(rows.length, 0);
    assert.equal(failed[0].gene, "X");
  });
  test("numbers are numeric covariates, anything else categories", () => {
    assert.deepEqual(covariateKinds([{ values: ["1.5", "a"] }, { values: ["2", "b"] }], 2), ["num", "cat"]);
  });
});
const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, a + " is not " + b);
