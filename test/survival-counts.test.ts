// The grouped-row survival functions (kaplanMeierCounts, logRankCounts, logRankKCounts,
// applyCutoffCounts) against their per-patient references (kaplanMeier, logRank, logRankK,
// applyCutoff) on the same rows expanded to one record per patient. Equality is exact
// (deepStrictEqual): the same points at the same rounding, median, n, events, atRisk, unobserved,
// and the same log-rank chi², p, observed, expected and variance.
//
// test/fixtures/survival-counts.json holds real (months, event, n[, entry]) rows as the survival
// count query returned them from cBioPortal's public database for public studies: two groups
// stratified over two studies, three groups, and a left-truncated case (re-anchored to a timeline
// event). Each case keeps the analysis document that produced it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  kaplanMeier, logRank, logRankK, applyCutoff, seededRandom,
  kaplanMeierCounts, logRankCounts, logRankKCounts, applyCutoffCounts, survSubjects,
  type SurvRecord, type SurvCount,
} from "../lib/stats.ts";

/** One record per patient, the way the survival view used to expand its rows. */
const expand = (rows: SurvCount[]): SurvRecord[] =>
  rows.flatMap((r) => Array.from({ length: r.n }, () => (r.entry == null ? { t: r.t, event: r.event } : { t: r.t, event: r.event, entry: r.entry })));

function sameKm(rows: SurvCount[]) {
  assert.deepStrictEqual(kaplanMeierCounts(rows), kaplanMeier(expand(rows)));
}
function sameLogRank(strata: SurvCount[][][]) {
  if (strata[0].length === 2)
    assert.deepStrictEqual(logRankCounts(strata.map(([a, b]) => ({ a, b }))), logRank(strata.map(([a, b]) => ({ a: expand(a), b: expand(b) }))));
  assert.deepStrictEqual(logRankKCounts(strata.map((groups) => ({ groups }))), logRankK(strata.map((g) => ({ groups: g.map(expand) }))));
}

const r = (t: number, event: number, n: number, entry?: number): SurvCount => (entry == null ? { t, event, n } : { t, event, n, entry });

describe("grouped rows: edge cases", () => {
  test("deaths and censorings tied at the same time, in several rows each", () => {
    const a = [r(1, 1, 3), r(1, 0, 2), r(2, 1, 1), r(1, 1, 1), r(2, 0, 4), r(3, 1, 2)];
    const b = [r(1, 0, 3), r(2, 1, 2), r(2, 1, 1), r(4, 0, 5), r(3, 0, 1)];
    sameKm(a); sameKm(b); sameLogRank([[a, b]]);
  });
  test("an empty cohort", () => {
    sameKm([]);
    assert.deepStrictEqual(kaplanMeierCounts([]), { points: [{ t: 0, s: 1 }], median: null, n: 0, events: 0, atRisk: [] });
    sameLogRank([[[], []]]);
    sameLogRank([[[], [r(1, 1, 4)]]]);
    sameLogRank([[[r(1, 1, 4), r(2, 0, 3)], [r(1, 0, 2), r(3, 1, 1)], []]]);
  });
  test("everyone censored", () => {
    const a = [r(1, 0, 4), r(5, 0, 2)], b = [r(2, 0, 3)];
    sameKm(a); sameLogRank([[a, b]]);
    assert.equal(kaplanMeierCounts(a).events, 0);
  });
  test("entry equal to exit, and after it: never at risk, counted as unobserved", () => {
    const rows = [r(3, 1, 2, 3), r(2, 0, 1, 4), r(5, 1, 3, 1), r(6, 0, 2, 0), r(4, 1, 1, 2)];
    sameKm(rows);
    assert.equal(kaplanMeierCounts(rows).unobserved, 3);
    sameLogRank([[rows, [r(5, 1, 2, 5), r(7, 1, 2, 3), r(8, 0, 1)]]]);
  });
  test("rows of zero patients, unusable times and missing entries", () => {
    const rows = [r(1, 1, 0), r(-1, 1, 2), r(NaN, 0, 1), r(Infinity, 1, 1), r(2, 1, 3), r(4, 0, 2, 1), r(0, 1, 1)];
    sameKm(rows);
    sameLogRank([[rows, [r(2, 0, 2), r(3, 1, 3, 0.5)]]]);
  });
  test("a cutoff", () => {
    const rows = [r(1, 1, 2), r(10, 1, 3), r(12, 0, 4, 2), r(30, 1, 1, 25), r(6, 1, 2, 6)];
    for (const c of [0.5, 6, 10, 11, 25, 40]) {
      assert.deepStrictEqual(kaplanMeierCounts(applyCutoffCounts(rows, c)), kaplanMeier(applyCutoff(expand(rows), c)));
    }
  });
  test("a stratum with no events, and strata of different shapes", () => {
    const s1 = [[r(1, 0, 3)], [r(2, 0, 2)], [r(3, 0, 1)]];
    const s2 = [[r(1, 1, 3), r(4, 0, 2)], [r(2, 1, 5)], [r(1, 1, 1), r(3, 0, 6, 0.5)]];
    sameLogRank([s1, s2]);
    sameLogRank([s1.slice(0, 2), s2.slice(0, 2)]);
  });
  test("survSubjects counts patients, not rows", () => {
    assert.equal(survSubjects([r(1, 1, 3), r(2, 0, 4)]), 7);
    assert.equal(survSubjects([]), 0);
  });
});

describe("grouped rows: seeded random cohorts", () => {
  // Coarse times (so ties of deaths and censorings are common), some rows with delayed entry, some
  // whose entry is at or after their exit, k groups of 2..4 over 1..3 strata.
  const rnd = seededRandom(20261111);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const rowsOf = (truncated: boolean): SurvCount[] => Array.from({ length: int(0, 40) }, () => {
    const t = int(0, 60) / (rnd() < 0.5 ? 1 : 4);
    const entry = truncated && rnd() < 0.7 ? int(0, 50) / 2 : undefined;
    return r(t, rnd() < 0.55 ? 1 : 0, int(1, 30), entry);
  });
  for (let i = 0; i < 60; i++) {
    const truncated = i % 2 === 1, k = int(2, 4), strata = int(1, 3);
    test("case " + i + ": " + k + " groups, " + strata + " strata" + (truncated ? ", delayed entry" : ""), () => {
      const s = Array.from({ length: strata }, () => Array.from({ length: k }, () => rowsOf(truncated)));
      for (const g of s.flat()) sameKm(g);
      sameKm(s.flat().flat());
      sameLogRank(s);
      sameLogRank([s.reduce((acc, st) => acc.map((g, j) => [...g, ...st[j]]), s[0].map((): SurvCount[] => []))]);
      const c = int(5, 40);
      assert.deepStrictEqual(logRankKCounts(s.map((st) => ({ groups: st.map((g) => applyCutoffCounts(g, c)) }))),
        logRankK(s.map((st) => ({ groups: st.map((g) => applyCutoff(expand(g), c)) }))));
    });
  }
});

describe("grouped rows: real study data", () => {
  const fx = JSON.parse(readFileSync("test/fixtures/survival-counts.json", "utf8")) as {
    cases: { name: string; about: string; strata: { study: string; groups: number[][][] }[] }[];
  };
  const row = ([t, event, n, entry]: number[]) => r(t, event, n, entry);
  for (const c of fx.cases) {
    test(c.name + " — " + c.about, () => {
      const strata = c.strata.map((s) => s.groups.map((g) => g.map(row)));
      const groups = strata[0].map((_, j) => strata.flatMap((s) => s[j]));
      for (const g of groups) sameKm(g);
      for (const g of groups) assert.ok(survSubjects(g) > 0);
      sameLogRank([groups]);
      if (strata.length > 1) sameLogRank(strata);
      for (const g of groups)
        assert.deepStrictEqual(kaplanMeierCounts(applyCutoffCounts(g, 24)), kaplanMeier(applyCutoff(expand(g), 24)));
    });
  }
});
