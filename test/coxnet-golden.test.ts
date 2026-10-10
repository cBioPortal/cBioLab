// lib/coxnet.ts checked against scikit-survival (the elastic-net path, glmnet's algorithm and
// objective) and lifelines (delayed entry and strata, unpenalised; Harrell's C).
//
// test/fixtures/golden/coxnet.json holds seeded synthetic datasets and those libraries' fits on
// them (regenerate with `uv run python/golden/coxnet.py`; versions are pinned there and recorded
// in the fixture). Two coordinate-descent implementations stop at slightly different points, so
// coefficients are compared to an absolute 1e-4; the unpenalised fits and C to a relative 1e-6.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coxnetPath, concordance, partialLogLik, coxnetEnsemble, type CoxSubject, type CoxDesign } from "../lib/coxnet.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/coxnet.json", "utf8"));

function design(c: any): { subj: CoxSubject[]; X: CoxDesign; rows: Int32Array } {
  const n = c.time.length, nb = c.nbinary;
  const subj = c.time.map((t: number, i: number) => ({ time: t, event: !!c.event[i], entry: c.entry[i], stratum: c.stratum[i] }));
  const p = c.X[0].length;
  const X: CoxDesign = { n, binary: [], dense: [] };
  for (let j = 0; j < p; j++) {
    if (j < nb) X.binary.push({ name: "b" + j, rows: Int32Array.from(c.X.map((r: number[], i: number) => r[j] ? i : -1).filter((i: number) => i >= 0)) });
    else X.dense.push({ name: "d" + j, values: Float64Array.from(c.X.map((r: number[]) => r[j])) });
  }
  return { subj, X, rows: Int32Array.from({ length: n }, (_, i) => i) };
}

describe("coxnet against scikit-survival and lifelines", () => {
  for (const c of golden.cases.filter((c: any) => c.kind === "path")) {
    test(c.name + ": every coefficient at every penalty", () => {
      const { subj, X, rows } = design(c);
      const fit = coxnetPath(subj, X, rows, { alpha: c.alpha, lambdas: c.lambdas, standardize: false, tol: 1e-14 });
      c.coefs.forEach((want: number[], k: number) => want.forEach((w, j) =>
        assert.ok(Math.abs(fit.coefs[k][j] - w) <= 1e-4, `lambda ${c.lambdas[k]} coef ${j}: got ${fit.coefs[k][j]}, reference ${w}`)));
    });
  }
  for (const c of golden.cases.filter((c: any) => c.kind === "cox")) {
    test(c.name + ": coefficients and log-likelihood", () => {
      const { subj, X, rows } = design(c);
      const b = coxnetPath(subj, X, rows, { lambdas: [0], standardize: false, tol: 1e-14 }).coefs[0];
      c.coefs.forEach((w: number, j: number) => {
        const err = Math.abs(b[j] - w) / Math.max(Math.abs(w), 1e-12);
        assert.ok(err <= 1e-5, `coef ${j}: got ${b[j]}, reference ${w}`);
      });
      const ll = partialLogLik(subj, X, rows, b);
      assert.ok(Math.abs(ll - c.loglik) / Math.abs(c.loglik) <= 1e-6, `log-likelihood ${ll} vs ${c.loglik}`);
    });
  }
  for (const c of golden.cases.filter((c: any) => c.kind === "concordance")) {
    test("Harrell's C", () => {
      const subj = c.time.map((t: number, i: number) => ({ time: t, event: !!c.event[i], entry: 0, stratum: 0 }));
      const got = concordance(subj, Int32Array.from({ length: subj.length }, (_, i) => i), Float64Array.from(c.risk));
      assert.ok(Math.abs(got - c.c) <= 1e-9, `C ${got} vs ${c.c}`);
    });
  }
});

describe("the ensemble", () => {
  const c = golden.cases.find((c: any) => c.kind === "path");
  test("is deterministic, scores only held-out patients, and finds the planted effects", () => {
    const { subj, X } = design(c);
    const a = coxnetEnsemble(subj, X, { runs: 6, seed: 42 }), b = coxnetEnsemble(subj, X, { runs: 6, seed: 42 });
    assert.deepEqual([...a.risk], [...b.risk]);
    for (let i = 0; i < a.risk.length; i++) assert.equal(Number.isNaN(a.risk[i]), a.heldOut[i] === 0);
    // the data plant +0.8 on column 0 and -0.6 on column 1: both kept in every run, with that sign
    assert.equal(a.selected[0], 1); assert.ok(a.meanCoef[0] > 0.3);
    assert.equal(a.selected[1], 1); assert.ok(a.meanCoef[1] < -0.2);
    assert.ok(a.runs.every((r) => r.cIndex > 0.55), a.runs.map((r) => r.cIndex.toFixed(3)).join(" "));
  });
});
