// The clinical view (lib/views/clinical/run.ts): attribute distributions compared across cohorts from
// each site's value counts and additive moments. Driven with hand-made sites; every expected number
// below is worked by hand from the values written beside it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runClinical } from "../lib/views/clinical/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { AttrStats } from "../lib/federation.ts";
import type { ClinicalRow } from "../lib/views/clinical/types.ts";
import { kindText } from "./support/kind-text.ts";
import { clinicalKind } from "../lib/views/clinical/kind.ts";

/** a numeric attribute's description from its values, with the complete histogram */
function num(attribute: string, xs: number[], per: "patient" | "sample" = "patient"): AttrStats {
  const vc = new Map<number, number>();
  for (const x of xs) vc.set(x, (vc.get(x) || 0) + 1);
  return { attribute, per, kind: "num", n: xs.length, sum: xs.reduce((a, b) => a + b, 0), sumsq: xs.reduce((a, b) => a + b * b, 0),
    min: Math.min(...xs), max: Math.max(...xs), valueCounts: [...vc].map(([v, n]) => ({ v, n })) };
}
const cat = (attribute: string, values: Record<string, number>, per: "patient" | "sample" = "patient"): AttrStats =>
  ({ attribute, per, kind: "cat", values: Object.entries(values).map(([v, n]) => ({ v, n })) });

/** sites[study][cohort] = that site's descriptions for that cohort; the options each site was asked with are recorded */
function ctx(cohortStudies: Record<string, string[]>, sites: Record<string, Record<string, AttrStats[]>>) {
  const asked: { study: string; histograms?: boolean }[] = [];
  const resolvers = Object.fromEntries(Object.keys(sites).map((st) => [st, {
    instance: { id: st, mode: "aggregate-only", label: st, conn: {} },
    attributeStats: async (def: { name: string }, attrs: string[], opts?: { histograms?: boolean }) => {
      asked.push({ study: st, histograms: opts?.histograms });
      return (sites[st][def.name] || []).filter((x) => attrs.includes(x.attribute));
    },
  }]));
  const vNames = Object.keys(cohortStudies);
  const cohorts: Record<string, EvaluatedCohort> = Object.fromEntries(vNames.map((n) => [n, {
    studies: cohortStudies[n], count: 10 * cohortStudies[n].length, samples: 0, text: "",
    perStudy: Object.fromEntries(cohortStudies[n].map((st) => [st, { sql: "", count: 10, samples: 10, mode: "" }])),
  }]));
  const c: ViewRun = {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohortStudies[n]))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
  return { c, asked };
}
const run = async (attributes: unknown[], c: ViewRun): Promise<ViewResult> => {
  const r = await runClinical({ kind: "clinical", attributes } as never, c);
  return r instanceof Untimed ? r.result : r;
};
const rowsOf = (v: ViewResult) => (v as ViewResult & { clinical: ClinicalRow[] }).clinical;
const near = (a: number | undefined | null, b: number, tol = 1e-3) => assert.ok(a != null && Math.abs(a - b) < tol, a + " ≉ " + b);

describe("clinical: what it refuses", () => {
  const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: {} });

  test("no attributes, or none that is an attribute name", async () => {
    const r = await runClinical({ kind: "clinical" } as never, c);
    assert.ok(r instanceof Untimed);
    assert.equal(r.result.error, "clinical view needs attributes");
    assert.equal((await run(["bad name", ""], c)).error, "clinical view needs attributes");
  });

  test("more than 20 attributes", async () => {
    assert.match((await run(Array.from({ length: 21 }, (_, i) => "A" + i), c)).error!, /at most 20 attributes/);
  });

  test("fewer than two cohorts", async () => {
    assert.equal((await run(["AGE"], ctx({ A: ["s1"] }, { s1: {} }).c)).error, "clinical comparison needs at least 2 cohorts");
  });
});

describe("clinical: a categorical attribute", () => {
  test("Pearson chi-squared over the full vocabulary: Lung 3 / Breast 1 against 1 / 3", async () => {
    // expected 2 in every cell; chi2 = 4 × (1²/2) = 2 on 1 df; p = 2(1 − Φ(√2)) = 0.1573
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [cat("CT", { Lung: 3, Breast: 1 })], B: [cat("CT", { Lung: 1, Breast: 3 })] } });
    const v = await run([" CT "], c);
    assert.equal(v.error, undefined);
    const [r] = rowsOf(v);
    assert.equal(r.test, "chi-squared");
    near(r.statistic, 2);
    assert.equal(r.df, 1);
    near(r.p, 0.1573);
    assert.equal(r.q, r.p, "one tested attribute: q is p");
    assert.equal(r.distinct, 2);
    near(r.minExpected, 2);
    assert.deepEqual(r.cells, [{ cohort: "A", n: 4, top: [{ v: "Lung", n: 3 }, { v: "Breast", n: 1 }] }, { cohort: "B", n: 4, top: [{ v: "Breast", n: 3 }, { v: "Lung", n: 1 }] }]);
    assert.ok(v.method);
    assert.match(v.note!, /Benjamini–Hochberg across the 1 tested attributes/);
  });

  test("a value only one cohort has is part of the vocabulary; counts pool across a cohort's studies", async () => {
    // A: s1 {X 2}, s2 {X 1, Y 1} → X 3, Y 1; B: s1 {X 1}, s2 {Z 3} → X 1, Z 3. Vocabulary X, Y, Z.
    const { c } = ctx({ A: ["s1", "s2"], B: ["s1", "s2"] }, {
      s1: { A: [cat("CT", { X: 2 })], B: [cat("CT", { X: 1 })] },
      s2: { A: [cat("CT", { X: 1, Y: 1 })], B: [cat("CT", { Z: 3 })] },
    });
    const v = await run(["CT"], c);
    const [r] = rowsOf(v);
    assert.equal(r.distinct, 3);
    assert.equal(r.df, 2);
    assert.deepEqual(r.cells.map((x) => x.n), [4, 4]);
    assert.deepEqual(r.cells[0].top, [{ v: "X", n: 3 }, { v: "Y", n: 1 }]);
    assert.match(v.note!, /pooled across 2 studies without harmonizing vocabularies/);
  });
});

describe("clinical: a numeric attribute", () => {
  test("two cohorts in one study: Welch's t from the moments, with median/IQR and a Mann-Whitney U from the histograms", async () => {
    // A = 1, 2, 3 (mean 2, var 1); B = 4, 5, 6 (mean 5, var 1). t = −3 / √(1/3 + 1/3) = −3.674, df 4, two-sided p ≈ 0.0213.
    // Medians 2 and 5; quartiles (type 7) 1.5 / 2.5 and 4.5 / 5.5. Fully separated: U = 0 (or 9), exact p = 2/20 = 0.1.
    const { c, asked } = ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [num("AGE", [1, 2, 3])], B: [num("AGE", [4, 5, 6])] } });
    const v = await run(["AGE"], c);
    const [r] = rowsOf(v);
    assert.ok(asked.every((a) => a.histograms === true), "a single-study view asks for the complete histogram");
    assert.equal(r.test, "Welch t");
    near(Math.abs(r.statistic!), 3.6742);
    near(r.df, 4);
    near(r.p, 0.0213, 5e-4);
    assert.deepEqual(r.cells.map((x) => [x.n, x.mean, x.sd, x.min, x.max, x.median, x.q1, x.q3, x.histogramTruncated]),
      [[3, 2, 1, 1, 3, 2, 1.5, 2.5, false], [3, 5, 1, 4, 6, 5, 4.5, 5.5, false]]);
    assert.ok([0, 9].includes(r.rankStatistic!), String(r.rankStatistic));
    assert.ok(r.rankP! > 0.04 && r.rankP! <= 0.11, "the rank test's p: " + r.rankP);
    assert.match(v.note!, /Mann-Whitney U for 2 cohorts, Kruskal-Wallis for 3\+/);
  });

  test("three cohorts in one study: Welch's ANOVA and Kruskal-Wallis", async () => {
    // A = 1,2,3; B = 4,5,6; C = 7,8,9 (each variance 1, weight n/var = 3). Grand weighted mean 5.
    // numerator Σw(m−M)²/(k−1) = 3·18/2 = 27; λ = Σ(1−w/W)²/(n−1) = 3·(2/3)²/2 = 2/3;
    // denominator 1 + 2(k−2)/(k²−1)·λ = 7/6 → F = 23.1429, df1 2, df2 (k²−1)/(3λ) = 4.
    // Ranks 1–9, sums 6, 15, 24: H = 12/90 · (36+225+576)/3 − 30 = 7.2; p = e^(−3.6) = 0.0273.
    const { c } = ctx({ A: ["s1"], B: ["s1"], C: ["s1"] },
      { s1: { A: [num("AGE", [1, 2, 3])], B: [num("AGE", [4, 5, 6])], C: [num("AGE", [7, 8, 9])] } });
    const [r] = rowsOf(await run(["AGE"], c));
    assert.equal(r.test, "Welch ANOVA");
    near(r.statistic, 23.142857);
    assert.equal(r.df, 2);
    near(r.df2, 4);
    near(r.rankStatistic, 7.2);
    near(r.rankP, Math.exp(-3.6));
  });

  test("across studies: moments pool exactly, and no histogram is asked for, so no median and no rank test", async () => {
    // A: s1 = 1, 2 and s2 = 3 → n 3, Σ 6, Σx² 14: mean 2, var 1, exactly as if one site held all three.
    const { c, asked } = ctx({ A: ["s1", "s2"], B: ["s1", "s2"] }, {
      s1: { A: [num("AGE", [1, 2])], B: [num("AGE", [4, 5])] },
      s2: { A: [num("AGE", [3])], B: [num("AGE", [6])] },
    });
    const v = await run(["AGE"], c);
    const [r] = rowsOf(v);
    assert.ok(asked.every((a) => a.histograms === false));
    assert.deepEqual(r.cells.map((x) => [x.n, x.mean, x.sd, x.min, x.max, x.median]), [[3, 2, 1, 1, 3, null], [3, 5, 1, 4, 6, null]]);
    near(Math.abs(r.statistic!), 3.6742);
    assert.equal(r.rankStatistic, undefined);
    assert.equal(r.rankP, undefined);
  });

  test("three cohorts across studies: Welch's ANOVA, without Kruskal-Wallis", async () => {
    const { c } = ctx({ A: ["s1", "s2"], B: ["s1"], C: ["s2"] }, {
      s1: { A: [num("AGE", [1, 2])], B: [num("AGE", [4, 5, 6])] },
      s2: { A: [num("AGE", [3])], C: [num("AGE", [7, 8, 9])] },
    });
    const [r] = rowsOf(await run(["AGE"], c));
    near(r.statistic, 23.142857);
    assert.equal(r.rankStatistic, undefined);
  });

  test("a histogram past the cap: median, IQR and the rank test are refused, and the cell says so", async () => {
    const trunc = (xs: number[]): AttrStats => ({ ...num("AGE", xs), valueCounts: undefined, histogramTruncated: true });
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [trunc([1, 2, 3])], B: [num("AGE", [4, 5, 6])] } });
    const [r] = rowsOf(await run(["AGE"], c));
    assert.equal(r.cells[0].median, null);
    assert.equal(r.cells[0].histogramTruncated, true);
    assert.equal(r.cells[1].median, 5);
    assert.equal(r.rankStatistic, undefined, "a rank test from a partial histogram would be an approximation");
    near(Math.abs(r.statistic!), 3.6742, 1e-3);
  });

  test("a cohort with no values: n 0, no mean, no range", async () => {
    const empty: AttrStats = { attribute: "AGE", per: "patient", kind: "num", n: 0 };
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [empty], B: [num("AGE", [4, 5, 6])] } });
    const [r] = rowsOf(await run(["AGE"], c));
    assert.deepEqual([r.cells[0].n, r.cells[0].mean, r.cells[0].min, r.cells[0].max, r.cells[0].median], [0, null, null, null, null]);
  });
});

describe("clinical: attributes that cannot be tested are named, never dropped", () => {
  test("no study reports it; a site refuses it; sites disagree on its type", async () => {
    const { c } = ctx({ A: ["s1", "s2"], B: ["s1", "s2"] }, {
      s1: { A: [num("MIXED", [1, 2]), { attribute: "HUGE", per: "sample", kind: "cat", skipped: "too many distinct values" }], B: [num("MIXED", [3])] },
      s2: { A: [cat("MIXED", { a: 1 })], B: [] },
    });
    const v = await run(["NONE", "HUGE", "MIXED"], c);
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => [r.attribute, r.skipped]), [
      ["NONE", "no participating study reports this attribute"],
      ["HUGE", "too many distinct values"],
      ["MIXED", "the participating studies disagree on its type (num vs cat); comparing them would mean discarding one side's patients"],
    ]);
    assert.equal(rows[1].per, "sample");
    assert.ok(rows.every((r) => r.p == null && r.cells.length === 0));
    assert.match(v.note!, /across the 0 tested attributes/);
  });
});

describe("clinical: q-values across attributes", () => {
  test("Benjamini–Hochberg over the tested attributes, rows ordered by p", async () => {
    // CT: p = 0.1573 (above); AGE: p ≈ 0.0213 (above). Sorted: AGE, CT. q(CT) = 0.1573 · 2/2; q(AGE) = min(0.0213 · 2/1, q(CT)) = 0.0426.
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: {
      A: [cat("CT", { Lung: 3, Breast: 1 }), num("AGE", [1, 2, 3])],
      B: [cat("CT", { Lung: 1, Breast: 3 }), num("AGE", [4, 5, 6])],
    } });
    const rows = rowsOf(await run(["CT", "AGE", "MISSING"], c));
    assert.deepEqual(rows.map((r) => r.attribute), ["AGE", "CT", "MISSING"], "the untested attribute sorts last");
    near(rows[1].q, rows[1].p!);
    near(rows[0].q, 2 * rows[0].p!, 1e-9);
  });
});

test("a numeric attribute with no mean and no spread", () => {
  const [t] = kindText(clinicalKind, { clinical: [{ attribute: "AGE", per: "patient", kind: "num", cells: [{ cohort: "A", mean: null, sd: null, n: 0 }] }] });
  assert.ok(t.includes("AGE [patient, num]: A mean — (n=0)"), t);
});
