// fisherExact, chiSquareTest, benjaminiHochberg and cochranMantelHaenszel checked against scipy
// and statsmodels.
//
// test/fixtures/golden/tables.json holds 2x2, r x c and stratified tables (zeros, large counts,
// empty margins) and p-value families (ties, ones), with the libraries' results on them
// (regenerate with `uv run python/golden/tables.py`). p- and q-values are compared to a relative
// 1e-6; statistics we report to 4 decimals are compared to 5e-5.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fisherExact, chiSquareTest, benjaminiHochberg, cochranMantelHaenszel } from "../lib/stats.ts";
import { VERIFIED } from "../lib/method.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/tables.json", "utf8"));

function closeRel(actual: number, expected: number, what: string, tol = 1e-6): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  assert.ok(err <= tol, what + ": got " + actual + ", reference " + expected + " (relative error " + err.toExponential(2) + ")");
}
const close4 = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= 5e-5, what + ": got " + actual + ", reference " + expected);

describe("fisherExact matches scipy.stats.fisher_exact (two-sided) — scipy " + golden.libraries.scipy, () => {
  for (const c of golden.fisher) {
    test("[[" + c.table[0] + ", " + c.table[1] + "], [" + c.table[2] + ", " + c.table[3] + "]]", () => {
      const [a, b, cc, d] = c.table;
      closeRel(fisherExact(a, b, cc, d), c.p, "p");
    });
  }
});

describe("chiSquareTest matches scipy.stats.chi2_contingency without continuity correction", () => {
  for (const c of golden.chi2) {
    test(JSON.stringify(c.table), () => {
      const r = chiSquareTest(c.table);
      assert.equal(r.df, c.df);
      close4(r.chi2, c.chi2, "chi2");
      closeRel(r.p, c.p, "p");
      assert.ok(Math.abs(r.minExpected - c.minExpected) <= 5e-3, "minExpected: got " + r.minExpected + ", reference " + c.minExpected);
    });
  }
});

describe("benjaminiHochberg matches statsmodels multipletests(method='fdr_bh') — statsmodels " + golden.libraries.statsmodels, () => {
  for (const c of golden.bh) {
    test(c.p.length + " p-values", () => {
      benjaminiHochberg(c.p).forEach((q, i) => closeRel(q, c.q[i], "q[" + i + "]"));
    });
  }
});

describe("cochranMantelHaenszel matches statsmodels StratifiedTable (R's continuity-correction rule)", () => {
  for (const c of golden.cmh) {
    test(c.strata.length + " strata: " + JSON.stringify(c.strata), () => {
      const r = cochranMantelHaenszel(c.strata.map((s: number[]) => ({ a: s[0], b: s[1], c: s[2], d: s[3] })));
      assert.equal(r.tables, c.tables, "strata with no empty margin");
      close4(r.chi2, c.chi2, "chi2");
      closeRel(r.p, c.p, "p");
      close4(r.oddsRatio!, c.oddsRatio, "Mantel-Haenszel odds ratio");
    });
  }
});

test("the table tests' verification claim names the library versions this fixture was made with", () => {
  assert.equal(VERIFIED.fisher.version, golden.libraries.scipy);
  assert.equal(VERIFIED.bh.version, golden.libraries.statsmodels);
});
