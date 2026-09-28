// Cumulative incidence with a competing risk (lib/stats.ts), checked three ways: against
// R's cmprsk 2.2.12 on a fixed synthetic data set, against identities any correct estimator
// satisfies, and — for delayed entry, which cmprsk does not support — against Kaplan–Meier.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aalenJohansen, cifAt, grayPermutationTest, kaplanMeier, seededRandom, type CrRecord } from "../lib/stats.ts";

/** The generator the reference numbers below were produced from (seed 3, effect 1.6). */
function synthetic(seed: number, effect: number): [CrRecord[], CrRecord[]] {
  const rnd = seededRandom(seed);
  const exp = (rate: number) => -Math.log(1 - rnd()) / rate;
  const gen = (n: number, h1: number, h2: number): CrRecord[] => Array.from({ length: n }, () => {
    const t1 = exp(h1), t2 = exp(h2), c = exp(0.03);
    const t = Math.round(Math.min(t1, t2, c) * 10) / 10 + 0.1;
    return { t, cause: (t1 < t2 && t1 < c ? 1 : t2 < c ? 2 : 0) as 0 | 1 | 2 };
  });
  return [gen(300, 0.02 * effect, 0.04), gen(300, 0.02, 0.04)];
}

describe("aalenJohansen against R cmprsk::cuminc", () => {
  const [A, B] = synthetic(3, 1.6);
  // cuminc(t, cause, group, cencode = 0); timepoints(ci, c(6, 12, 24, 48))
  const R = { A: [0.16887, 0.28246, 0.3579, 0.41574], B: [0.10944, 0.21767, 0.31118, 0.37594] };
  const Rse = { A: [0.02285, 0.02862, 0.03234, 0.0356], B: [0.01862, 0.02579, 0.03061, 0.03513] };
  test("the cumulative incidence matches to five decimals", () => {
    for (const [name, g] of [["A", A], ["B", B]] as const) {
      const c = aalenJohansen(g);
      [6, 12, 24, 48].forEach((t, i) => assert.ok(Math.abs(cifAt(c, t).f1 - R[name][i]) < 5e-6, name + "@" + t + ": " + cifAt(c, t).f1));
    }
  });
  test("the delta-method standard error is within 3% of cmprsk's own estimator", () => {
    for (const [name, g] of [["A", A], ["B", B]] as const) {
      const c = aalenJohansen(g);
      [6, 12, 24, 48].forEach((t, i) => {
        const se = cifAt(c, t).se1;
        assert.ok(Math.abs(se - Rse[name][i]) / Rse[name][i] < 0.03, name + "@" + t + ": " + se + " vs " + Rse[name][i]);
      });
    }
  });
  test("Gray's test by permutation agrees with cmprsk's asymptotic one (stat 1.5337, p 0.21555)", () => {
    const g = grayPermutationTest([A, B], 4000, 7);
    assert.ok(Math.abs(g.statistic - 1.5337) / 1.5337 < 0.05, "stat " + g.statistic);
    assert.ok(Math.abs(g.p - 0.21555) < 0.03, "p " + g.p);
  });
});

describe("identities", () => {
  test("with no competing event, cumulative incidence is exactly 1 − Kaplan–Meier, delayed entry included", () => {
    const rnd = seededRandom(5);
    const recs: CrRecord[] = Array.from({ length: 400 }, () => {
      const entry = Math.round(rnd() * 20) / 2, t = entry + 0.5 + Math.round(rnd() * 60) / 2;
      return { entry, t, cause: (rnd() < 0.6 ? 1 : 0) as 0 | 1 };
    });
    const cif = aalenJohansen(recs);
    const km = kaplanMeier(recs.map((r) => ({ t: r.t, event: r.cause, entry: r.entry })));
    // kaplanMeier rounds its survival to four decimals
    for (const p of km.points) assert.ok(Math.abs(cifAt(cif, p.t).f1 - (1 - p.s)) < 1e-4, "t=" + p.t);
  });
  test("with no censoring or truncation, F1(t) is the plain share with cause 1 by t, and F1 + F2 reaches 1", () => {
    const recs: CrRecord[] = [1, 2, 2, 3, 4, 5, 6, 7, 8, 9].map((t, i) => ({ t, cause: (i % 3 === 0 ? 2 : 1) as 1 | 2 }));
    const c = aalenJohansen(recs);
    for (const t of [1, 2, 5, 9]) {
      const share = recs.filter((r) => r.t <= t && r.cause === 1).length / recs.length;
      assert.ok(Math.abs(cifAt(c, t).f1 - share) < 1e-12, "t=" + t);
    }
    const last = c.points[c.points.length - 1];
    assert.ok(Math.abs(last.f1 + last.f2 - 1) < 1e-12);
  });
  test("counts come back as given", () => {
    const c = aalenJohansen([{ t: 1, cause: 1 }, { t: 2, cause: 2 }, { t: 3, cause: 0 }]);
    assert.deepEqual([c.n, c.events, c.competing, c.censored], [3, 1, 1, 1]);
  });
});

describe("grayPermutationTest", () => {
  test("two draws from one distribution are not called different; a real difference is", () => {
    const [A] = synthetic(21, 1), [B] = synthetic(22, 1);
    assert.ok(grayPermutationTest([A, B], 999).p > 0.05);
    const [C, D] = synthetic(23, 3);
    assert.ok(grayPermutationTest([C, D], 999).p < 0.01);
  });
  test("reproducible for a given seed", () => {
    const [A, B] = synthetic(3, 1.6);
    assert.equal(grayPermutationTest([A, B], 300, 4).p, grayPermutationTest([A, B], 300, 4).p);
  });
});
