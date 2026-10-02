// kaplanMeier, logRank and logRankK checked against lifelines and statsmodels.
//
// test/fixtures/golden/survival.json holds seeded synthetic survival data and the libraries'
// results on it (regenerate with `uv run python/golden/survival.py`). Kaplan-Meier survival is
// compared within 5e-5 because our curves are reported to 4 decimals; medians, counts, log-rank
// chi-squared (reported to 4 decimals) and p-values are compared exactly or to a relative 1e-6.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kaplanMeier, logRank, logRankK, type SurvRecord } from "../lib/stats.ts";
import { VERIFIED } from "../lib/method.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/survival.json", "utf8"));

describe("kaplanMeier matches lifelines KaplanMeierFitter — lifelines " + golden.libraries.lifelines, () => {
  for (const c of golden.km) {
    test(c.name + " — " + c.about, () => {
      const fit = kaplanMeier(c.rows as SurvRecord[]);
      assert.equal(fit.n, c.expected.n);
      assert.equal(fit.events, c.expected.events);
      assert.equal(fit.median, c.expected.median);
      const ours = new Map(fit.points.map((p) => [p.t, p.s]));
      assert.equal(ours.size - 1, c.expected.points.length, "one step per event time, plus t=0");
      for (const p of c.expected.points) {
        const s = ours.get(p.t);
        assert.ok(s != null, "a step at t=" + p.t);
        assert.ok(Math.abs(s! - p.s) <= 5e-5, "S(" + p.t + "): got " + s + ", reference " + p.s);
      }
    });
  }
});

describe("logRank / logRankK match statsmodels survdiff — statsmodels " + golden.libraries.statsmodels, () => {
  for (const c of golden.logrank) {
    test(c.name + " — " + c.about, () => {
      const r = c.groups === 2
        ? logRank(c.strata.map((s: SurvRecord[][]) => ({ a: s[0], b: s[1] })))
        : logRankK(c.strata.map((s: SurvRecord[][]) => ({ groups: s })));
      assert.equal(r.df, c.expected.df);
      assert.ok(Math.abs(r.chi2 - c.expected.chi2) <= 5e-5, "chi2: got " + r.chi2 + ", reference " + c.expected.chi2);
      const err = Math.abs(r.p - c.expected.p) / c.expected.p;
      assert.ok(err <= 1e-6, "p: got " + r.p + ", reference " + c.expected.p + " (relative error " + err.toExponential(2) + ")");
    });
  }
});

test("the survival method record's verification claim names the library versions this fixture was made with", () => {
  assert.equal(VERIFIED.km.version, golden.libraries.lifelines);
  assert.equal(VERIFIED.logrank.version, golden.libraries.statsmodels);
});
