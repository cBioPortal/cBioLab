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
import { benjaminiHochberg } from "../lib/stats.ts";

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

describe("clinical: the portal's rule for what can be tested (CMP-STM-6, CMP-STM-7, CMP-CL-2)", () => {
  // ClinicalDataEnrichmentUtil: a categorical test needs ≥2 values over all groups and ≥2 groups holding any;
  // a numeric one ≥2 groups with values and ≥2 distinct values. The rest are listed as not tested, outside q.
  const one = async (a: AttrStats, b: AttrStats) => rowsOf(await run([a.attribute], ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [a], B: [b] } }).c))[0];
  test("a categorical attribute with one value in every group", async () => {
    const r = await one(cat("SAMPLE_TYPE", { Primary: 10 }, "sample"), cat("SAMPLE_TYPE", { Primary: 8 }, "sample"));
    assert.equal(r.skipped, "one value in every group (Primary)");
    assert.equal(r.p, undefined); assert.equal(r.q, undefined);
    assert.deepEqual(r.cells.map((c) => c.n), [10, 8], "its counts are still shown");
  });
  test("a categorical attribute only one group holds", async () => {
    const r = await one(cat("SUBTYPE", { x: 3, y: 2 }), cat("SUBTYPE", {}));
    assert.equal(r.skipped, "only one group has a value");
  });
  test("a numeric attribute with one value everywhere (DAYS_TO_INITIAL_PATHOLOGIC_DIAGNOSIS, all 0)", async () => {
    const r = await one(num("DAYS", [0, 0, 0]), num("DAYS", [0, 0]));
    assert.equal(r.skipped, "one value in every group (0)");
    assert.equal(r.p, undefined);
  });
  test("a numeric attribute only one group holds", async () => {
    const r = await one(num("W", [1, 2]), { attribute: "W", per: "patient", kind: "num", n: 0 });
    assert.equal(r.skipped, "only one group has a value");
  });
  test("two values or two groups are enough", async () => {
    assert.ok((await one(cat("S", { a: 1 }), cat("S", { b: 1 }))).p != null);
    assert.ok((await one(num("N", [1, 1]), num("N", [2]))).p != null);
  });
  test("an untested attribute takes no part in the q-values", async () => {
    // AGE p ≈ 0.0213 and CT p = 0.1573 as above; with SAMPLE_TYPE constant, BH is over 2, so q(AGE) = 2p, not 3p
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: {
      A: [cat("CT", { Lung: 3, Breast: 1 }), num("AGE", [1, 2, 3]), cat("SAMPLE_TYPE", { Primary: 4 })],
      B: [cat("CT", { Lung: 1, Breast: 3 }), num("AGE", [4, 5, 6]), cat("SAMPLE_TYPE", { Primary: 4 })],
    } });
    const v = await run(["CT", "AGE", "SAMPLE_TYPE"], c);
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute), ["AGE", "CT", "SAMPLE_TYPE"]);
    near(rows[0].q, 2 * rows[0].p!, 1e-9);
    assert.match(v.note!, /across the 2 tested attributes/);
    assert.match(v.note!, /1 attribute is listed as not tested/);
  });
});

describe("clinical: every attribute the study declares (allAttributes, CMP-CL-2)", () => {
  /** a site that lists `declared` (id → display name) and describes every attribute as two-valued categorical */
  function listing(declared: Record<string, string>, opts: { remote?: string } = {}) {
    const { c, asked } = ctx({ A: ["s1", ...(opts.remote ? [opts.remote] : [])], B: ["s1"] }, { s1: {}, ...(opts.remote ? { [opts.remote]: {} } : {}) });
    const batches: string[][] = [];
    const statsOf = (name: string, attrs: string[]) => attrs.map((a) => cat(a, name === "A" ? { x: 3, y: 1 } : { x: 1, y: 3 }));
    for (const [st, r] of Object.entries(c.resolvers as Record<string, any>)) {
      r.attributeStats = async (def: { name: string }, attrs: string[]) => { batches.push(attrs); return st === "s1" ? statsOf(def.name, attrs) : []; };
      if (st !== opts.remote) {
        r.viewAggregate = async () => [];
        r.viewMeta = async (label: string, build: (s: string, d: string) => string) => {
          assert.equal(label, "clinicalAttributes");
          assert.match(build(st, "db"), /FROM db\.clinical_attribute_meta cam[\s\S]*cancer_study_identifier = 's1'/);
          return Object.entries(declared).map(([a, label]) => ({ a, label }));
        };
      }
    }
    return { c, asked, batches };
  }
  const runAll = async (c: ViewRun) => { const r = await runClinical({ kind: "clinical", allAttributes: true } as never, c); return r instanceof Untimed ? r.result : r; };
  test("leaves out the survival endpoints' pairs, AGE_LAST_FU_YEARS and BIRTH_YEAR, as the portal; keeps a lone _STATUS", async () => {
    const { c } = listing({ SEX: "Sex", OS_MONTHS: "Overall Survival (Months)", OS_STATUS: "Overall Survival Status", PFS_STATUS: "Progression Status",
      BIRTH_YEAR: "Birth year", AGE_LAST_FU_YEARS: "Age at last follow-up", WEIGHT: "Patient Weight" });
    const v = await runAll(c);
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["PFS_STATUS", "SEX", "WEIGHT"]);
    assert.deepEqual(rows.map((r) => r.label).sort(), ["Patient Weight", "Progression Status", "Sex"]);
    assert.match(v.note!, /Every clinical attribute the study declares is compared \(3\), but each survival endpoint's _MONTHS \/ _STATUS pair, AGE_LAST_FU_YEARS and BIRTH_YEAR are not listed, as on cBioPortal\./);
    assert.match(v.note!, /across the 7 tested attributes, 4 of them tested but not listed/);
  });
  test("45 attributes are asked for in batches of at most 20, and all tested", async () => {
    const { c, batches } = listing(Object.fromEntries(Array.from({ length: 45 }, (_, i) => ["ATTR_" + String(i).padStart(2, "0"), "Attr " + i])));
    const rows = rowsOf(await runAll(c));
    assert.equal(rows.length, 45);
    assert.ok(rows.every((r) => r.p != null && r.q != null));
    assert.deepEqual(batches.map((b) => b.length).sort((x, y) => x - y), [5, 5, 20, 20, 20, 20], "two cohorts × (20, 20, 5)");
  });
  test("past 300 attributes it is refused, the limit named", async () => {
    const { c } = listing(Object.fromEntries(Array.from({ length: 301 }, (_, i) => ["A" + i, "A" + i])));
    assert.match((await runAll(c)).error!, /every attribute means 301 here, and a clinical view tests at most 300/);
  });
  test("a participant that cannot list its attributes is named", async () => {
    const { c } = listing({ SEX: "Sex" }, { remote: "peer" });
    assert.match((await runAll(c)).note!, /; peer could not list its attributes, so only those the others declare are asked of it\./);
  });
  test("no attribute declared", async () => {
    const { c } = listing({ OS_MONTHS: "m", OS_STATUS: "s" });
    assert.equal((await runAll(c)).error, "the studies declare no clinical attribute to compare");
  });
});

describe("clinical: numeric attributes by rank, as the portal (rankTests, CMP-STM-7)", () => {
  // A 1,2,3 vs B 4,5,6: rank sums 6 and 15, N 6, no ties; H = 12/(6·7)·(6²/3 + 15²/3) − 3·7 = 27/7 ≈ 3.8571,
  // p = P(χ²₁ > 27/7) ≈ 0.049535 — the portal's Wilcoxon (normal approximation, no continuity correction): z = −4.5/√5.25
  const view = (attrs: string[], c: ViewRun, extra: object = {}) => runClinical({ kind: "clinical", attributes: attrs, rankTests: true, ...extra } as never, c);
  const rowOf = async (attrs: string[], c: ViewRun) => { const r = await view(attrs, c); return rowsOf(r instanceof Untimed ? r.result : r)[0]; };
  test("two groups: the Wilcoxon rank-sum as Kruskal-Wallis, its p the row's p and q", async () => {
    const r = await rowOf(["W"], ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [num("W", [1, 2, 3])], B: [num("W", [4, 5, 6])] } }).c);
    assert.equal(r.test, "Wilcoxon");
    near(r.statistic, 27 / 7, 1e-4);
    near(r.p, 0.0495346, 1e-6);
    assert.equal(r.q, r.p);
    assert.equal(r.rankP, undefined, "the rank test is the test, not a second one beside it");
  });
  test("ties are corrected: A 1,1,2 vs B 2,3,3", async () => {
    // ranks: 1,1 → 1.5; 2,2 → 3.5; 3,3 → 5.5. R_A = 6.5, R_B = 14.5; raw H = 12/42·(6.5²/3 + 14.5²/3) − 21 = 3.0476;
    // ties t = 2,2,2: correction 1 − 3·6/210 = 0.9143 → H = 3.3333, p = 0.067889
    const r = await rowOf(["W"], ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [num("W", [1, 1, 2])], B: [num("W", [2, 3, 3])] } }).c);
    near(r.statistic, 10 / 3, 1e-4);
    near(r.p, 0.0678892, 1e-6);
  });
  test("three groups: Kruskal-Wallis; a group with no values is left out of it", async () => {
    const empty: AttrStats = { attribute: "W", per: "patient", kind: "num", n: 0 };
    const three = await rowOf(["W"], ctx({ A: ["s1"], B: ["s1"], C: ["s1"] }, { s1: { A: [num("W", [1, 2, 3])], B: [num("W", [4, 5, 6])], C: [num("W", [7, 8, 9])] } }).c);
    assert.equal(three.test, "Kruskal-Wallis");
    assert.equal(three.df, 2);
    const two = await rowOf(["W"], ctx({ A: ["s1"], B: ["s1"], C: ["s1"] }, { s1: { A: [num("W", [1, 2, 3])], B: [num("W", [4, 5, 6])], C: [empty] } }).c);
    assert.equal(two.test, "Kruskal-Wallis", "named by the groups compared, as the portal names it");
    near(two.p, 0.0495346, 1e-6);
  });
  test("across studies there is no whole distribution: Welch's test, as without rankTests", async () => {
    const { c } = ctx({ A: ["s1", "s2"], B: ["s1", "s2"] }, { s1: { A: [num("W", [1, 2])], B: [num("W", [5, 6])] }, s2: { A: [num("W", [3])], B: [num("W", [4])] } });
    assert.equal((await rowOf(["W"], c)).test, "Welch t");
  });
  test("the note and the method record say so, and the script recomputes it by scipy's kruskal", async () => {
    const r = await view(["W"], ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [num("W", [1, 2, 3])], B: [num("W", [4, 5, 6])] } }).c);
    const v = r instanceof Untimed ? r.result : r;
    assert.match(v.note!, /numeric ones by rank, as cBioPortal's Comparison page tests them: Kruskal-Wallis, tie-corrected/);
    assert.ok(v.method!.steps.some((s) => /^Kruskal–Wallis for each numeric attribute/.test(s.title)));
    assert.match(v.method!.python!, /ranked = \["W"\]/);
    assert.match(v.method!.python!, /p_values\[attr\] = kruskal\(\*values\)\.pvalue/);
  });
});

describe("clinical: q-values over every tested attribute, listed or not (allAttributes, CMP-STM-8, CMP-CL-2)", () => {
  // The portal's ComparisonStore takes BH over every enrichment the backend returns; its table then hides the
  // survival pairs, AGE_LAST_FU_YEARS and BIRTH_YEAR. So those are tested and counted in n, though not listed.
  type Pair = [AttrStats, AttrStats];
  const two = (a: string, x: Record<string, number>, y: Record<string, number>): Pair => [cat(a, x), cat(a, y)];
  const constant = (a: string): Pair => [cat(a, { only: 4 }), cat(a, { only: 4 })];
  const sep = (a: string): Pair => [num(a, [1, 2, 3]), num(a, [4, 5, 6])];
  /** one study declaring every key of `spec` in order; spec[attr] = [cohort A's description, cohort B's] */
  function site(spec: Record<string, Pair>) {
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, { s1: {} });
    const r = (c.resolvers as Record<string, any>).s1;
    r.attributeStats = async (def: { name: string }, attrs: string[]) =>
      attrs.filter((a) => spec[a]).map((a) => spec[a][def.name === "A" ? 0 : 1]);
    r.viewAggregate = async () => [];
    r.viewMeta = async () => Object.keys(spec).map((a) => ({ a, label: a + " label" }));
    return c;
  }
  const runView = async (view: object, c: ViewRun) => { const r = await runClinical({ kind: "clinical", ...view } as never, c); return r instanceof Untimed ? r.result : r; };
  const all = (c: ViewRun) => runView({ allAttributes: true }, c);
  /** p-values for the five attributes, all distinct, from the cases worked above and Pearson χ² on 2×2 tables */
  const five = (): Record<string, Pair> => ({
    A: two("A", { x: 3, y: 1 }, { x: 1, y: 3 }),                       // χ² 2, p 0.1573
    B: two("B", { x: 4, y: 0 }, { x: 1, y: 3 }),                       // χ² 4.8, p 0.0285
    OS_MONTHS: sep("OS_MONTHS"),                                       // Welch t, p 0.0213
    OS_STATUS: two("OS_STATUS", { x: 2, y: 2 }, { x: 1, y: 3 }),       // χ² 0.5333, p 0.4652
    AGE_LAST_FU_YEARS: two("AGE_LAST_FU_YEARS", { x: 5, y: 1 }, { x: 1, y: 5 }), // χ² 5.3333, p 0.0209
  });
  /** the p each attribute gets when it is the only one asked for, so q = p */
  const soloP = async (pair: Pair) => rowsOf(await runView({ attributes: [pair[0].attribute] }, ctx({ A: ["s1"], B: ["s1"] }, { s1: { A: [pair[0]], B: [pair[1]] } }).c))[0].p!;
  async function expectedQ(spec: Record<string, Pair>, tested: string[]) {
    const ps = await Promise.all(tested.map((a) => soloP(spec[a])));
    const qs = benjaminiHochberg(ps);
    return Object.fromEntries(tested.map((a, i) => [a, qs[i]]));
  }

  test("row 1: only the listed attributes are rows — the survival pair and AGE_LAST_FU_YEARS are not", async () => {
    const rows = rowsOf(await all(site(five())));
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["A", "B"]);
  });

  test("row 2: each listed row's q is Benjamini–Hochberg over all five p-values, not over the two listed", async () => {
    const spec = five();
    const q = await expectedQ(spec, Object.keys(spec));
    const rows = rowsOf(await all(site(spec)));
    for (const r of rows) near(r.q, q[r.attribute], 1e-9);
    // over the two listed alone, q(B) would be 2·0.0285 = 0.0569 and q(A) = 0.1573; over five, 0.0474 and 0.1966
    const b = rows.find((r) => r.attribute === "B")!;
    const a = rows.find((r) => r.attribute === "A")!;
    near(b.q, 0.047433, 1e-5);
    near(a.q, 0.196624, 1e-5);
    assert.notEqual(a.q, a.p, "BH over two would leave the larger p unchanged");
  });

  test("row 3: an untestable hidden attribute is not in n and not listed", async () => {
    const spec = { ...five(), AGE_LAST_FU_YEARS: constant("AGE_LAST_FU_YEARS") };
    const q = await expectedQ(spec, ["A", "B", "OS_MONTHS", "OS_STATUS"]);
    const v = await all(site(spec));
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["A", "B"]);
    for (const r of rows) near(r.q, q[r.attribute], 1e-9);
    assert.match(v.note!, /across the 4 tested attributes, 2 of them tested but not listed/);
    assert.doesNotMatch(v.note!, /listed as not tested/);
  });

  test("row 4: a _MONTHS without its _STATUS is not a survival pair — listed and tested as any attribute", async () => {
    const spec = { A: five().A, B: five().B, PFS_MONTHS: sep("PFS_MONTHS") };
    const q = await expectedQ(spec, ["A", "B", "PFS_MONTHS"]);
    const v = await all(site(spec));
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["A", "B", "PFS_MONTHS"]);
    for (const r of rows) near(r.q, q[r.attribute], 1e-9);
    assert.match(v.note!, /across the 3 tested attributes/);
    assert.doesNotMatch(v.note!, /tested but not listed/);
  });

  test("row 5: named attributes — nothing hidden is added, q over the named tested ones", async () => {
    const spec = five();
    const q = await expectedQ(spec, ["A", "B"]);
    const v = await runView({ attributes: ["A", "B"] }, site(spec));
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["A", "B"]);
    for (const r of rows) near(r.q, q[r.attribute], 1e-9);
    near(rows.find((r) => r.attribute === "B")!.q, 2 * 0.0284597, 1e-5);
    assert.match(v.note!, /across the 2 tested attributes/);
    assert.doesNotMatch(v.note!, /tested but not listed/);
  });

  test("row 6: the note gives N tested and M of them not listed", async () => {
    const v = await all(site(five()));
    assert.match(v.note!, /Benjamini–Hochberg across the 5 tested attributes, 3 of them tested but not listed/);
  });

  test("row 7: the method record lists every tested attribute, hidden ones included, so its script reproduces each q", async () => {
    const spec = five();
    const q = await expectedQ(spec, Object.keys(spec));
    const m = (await all(site(spec))).method!;
    assert.ok(m.check, "a check record");
    for (const a of Object.keys(spec)) {
      assert.ok(m.check!["clinical:" + a + ":p"], "p of " + a + " in the check record");
      near(m.check!["clinical:" + a + ":q"]?.v, q[a], 1e-9);
    }
    const listed = m.steps.find((s) => s.title === "List the studies' clinical attributes")!;
    assert.equal(listed.rowsOut, 5);
    assert.match(listed.detail!, /AGE_LAST_FU_YEARS, OS_MONTHS, OS_STATUS/);
    assert.match(m.steps.find((s) => /^Benjamini–Hochberg/.test(s.title))!.detail!, /over the 5 tested attributes/);
    const statParams = m.steps.flatMap((s) => (s.kind === "statistic" ? s.params || [] : []).map(([name]) => name));
    for (const a of Object.keys(spec)) assert.ok(statParams.includes(a), a + " among the tested in the method steps");
    assert.ok(m.python, "a script");
    for (const a of Object.keys(spec)) for (const co of ["A", "B"]) assert.ok(m.python!.includes('"' + co + ",s1," + a + ","), a + " of cohort " + co + " in the script's data");
    assert.match(m.python!, /multipletests\(list\(p_values\.values\(\)\), method="fdr_bh"\)/, "BH over every attribute the script tests");
  });

  test("row 8: the note's untested count counts listed rows only", async () => {
    const spec = { ...five(), C: constant("C"), BIRTH_YEAR: constant("BIRTH_YEAR") };
    const v = await all(site(spec));
    const rows = rowsOf(v);
    assert.deepEqual(rows.map((r) => r.attribute).sort(), ["A", "B", "C"]);
    assert.ok(rows.find((r) => r.attribute === "C")!.skipped);
    assert.match(v.note!, /across the 5 tested attributes, 3 of them tested but not listed/);
    assert.match(v.note!, /1 attribute is listed as not tested/);
  });
});

describe("clinical: an attribute stored at different levels across studies", () => {
  // cBioPortal/cbioportal#12509: a patient-level value in one study beside a sample-level value in another would
  // count patients in one place and samples in the other. Where the studies holding values disagree on `per`, the
  // attribute is named and not tested. Rows A1–A11 of the spec table (A8, A10, A11 from its revision 2).
  const levels = (patient: string, sample: string) =>
    `the participating studies store it at different levels (patient in ${patient}; sample in ${sample}); its counts would mix patients with samples`;
  const two = { A: ["s1", "s2"], B: ["s1", "s2"] };

  test("A1: categorical, patient-level in s1 and sample-level in s2, both holding values → refused, outside q", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("HISTOLOGY", { Adeno: 3, Squamous: 1 })], B: [cat("HISTOLOGY", { Adeno: 1, Squamous: 3 })] },
      s2: { A: [cat("HISTOLOGY", { Adeno: 2, Squamous: 2 }, "sample")], B: [cat("HISTOLOGY", { Adeno: 1, Squamous: 4 }, "sample")] },
    });
    const v = await run(["HISTOLOGY"], c);
    const [r] = rowsOf(v);
    assert.equal(r.skipped, levels("s1", "s2"));
    assert.equal(r.p, undefined);
    assert.equal(r.q, undefined);
    assert.deepEqual(r.cells, []);
    assert.match(v.note!, /across the 0 tested attributes/);
  });

  test("A2: numeric, patient-level in s1 and sample-level in s2, both with n > 0 → refused", async () => {
    const { c } = ctx(two, {
      s1: { A: [num("TOTAL_MUTATIONS", [1, 2, 3])], B: [num("TOTAL_MUTATIONS", [4, 5, 6])] },
      s2: { A: [num("TOTAL_MUTATIONS", [2, 3], "sample")], B: [num("TOTAL_MUTATIONS", [7, 8], "sample")] },
    });
    const v = await run(["TOTAL_MUTATIONS"], c);
    const [r] = rowsOf(v);
    assert.equal(r.skipped, levels("s1", "s2"));
    assert.equal(r.p, undefined);
    assert.equal(r.q, undefined);
    assert.deepEqual(r.cells, []);
    assert.match(v.note!, /across the 0 tested attributes/);
  });

  test("A3: both studies patient-level → tested normally", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("CT", { Lung: 3, Breast: 1 })], B: [cat("CT", { Lung: 1, Breast: 3 })] },
      s2: { A: [cat("CT", { Lung: 2 })], B: [cat("CT", { Breast: 2 })] },
    });
    const [r] = rowsOf(await run(["CT"], c));
    assert.equal(r.skipped, undefined);
    assert.equal(r.test, "chi-squared");
    assert.ok(r.p != null);
    assert.equal(r.per, "patient");
  });

  test("A4: both sample-level, one cohort of s2 empty (the default per: patient, values []) → tested, per sample", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("ST", { Primary: 3, Metastasis: 1 }, "sample")], B: [cat("ST", { Primary: 1, Metastasis: 3 }, "sample")] },
      s2: { A: [cat("ST", { Primary: 2, Metastasis: 1 }, "sample")], B: [cat("ST", {})] },
    });
    const [r] = rowsOf(await run(["ST"], c));
    assert.equal(r.skipped, undefined);
    assert.ok(r.p != null);
    assert.equal(r.per, "sample");
  });

  test("A5: patient-level values in s1; every answer of s2 is the empty default → only one level holds values, tested", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("CT", { Lung: 3, Breast: 1 })], B: [cat("CT", { Lung: 1, Breast: 3 })] },
      s2: { A: [cat("CT", {})], B: [cat("CT", {})] },
    });
    const [r] = rowsOf(await run(["CT"], c));
    assert.equal(r.skipped, undefined);
    assert.ok(r.p != null);
  });

  test("A6: kind and level both disagree → the type message wins", async () => {
    const { c } = ctx(two, {
      s1: { A: [num("MIXED", [1, 2])], B: [num("MIXED", [3, 4])] },
      s2: { A: [cat("MIXED", { a: 1, b: 1 }, "sample")], B: [cat("MIXED", { a: 2 }, "sample")] },
    });
    const [r] = rowsOf(await run(["MIXED"], c));
    assert.equal(r.skipped, "the participating studies disagree on its type (num vs cat); comparing them would mean discarding one side's patients");
    assert.equal(r.p, undefined);
  });

  test("A7: three studies, s1 and s3 patient-level, s2 sample-level → each level's studies listed, sorted", async () => {
    const { c } = ctx({ A: ["s3", "s2", "s1"], B: ["s3", "s2", "s1"] }, {
      s3: { A: [cat("HISTOLOGY", { x: 2 })], B: [cat("HISTOLOGY", { y: 2 })] },
      s2: { A: [cat("HISTOLOGY", { x: 1, y: 1 }, "sample")], B: [cat("HISTOLOGY", { y: 3 }, "sample")] },
      s1: { A: [cat("HISTOLOGY", { x: 3 })], B: [cat("HISTOLOGY", { x: 1, y: 2 })] },
    });
    const [r] = rowsOf(await run(["HISTOLOGY"], c));
    assert.equal(r.skipped, levels("s1, s3", "s2"));
    assert.deepEqual(r.cells, []);
  });

  test("A8: one study whose cohort A answer is per patient and cohort B answer per sample, both holding values → refused, the study named", async () => {
    const { c } = ctx({ A: ["s1"], B: ["s1"] }, {
      s1: { A: [cat("CT", { Lung: 3, Breast: 1 })], B: [cat("CT", { Lung: 1, Breast: 3 }, "sample")] },
    });
    const v = await run(["CT"], c);
    const [r] = rowsOf(v);
    assert.equal(r.skipped, "s1 stores it both per patient and per sample; its counts would mix patients with samples");
    assert.equal(r.p, undefined);
    assert.equal(r.q, undefined);
    assert.deepEqual(r.cells, []);
    assert.match(v.note!, /across the 0 tested attributes/);
    // the same study at one level throughout is tested as before
    const { c: plain } = ctx({ A: ["s1"], B: ["s1"] }, {
      s1: { A: [cat("CT", { Lung: 3, Breast: 1 }, "sample")], B: [cat("CT", { Lung: 1, Breast: 3 }, "sample")] },
    });
    const [p] = rowsOf(await run(["CT"], plain));
    assert.equal(p.skipped, undefined);
    near(p.p, 0.1573);
  });

  test("A8b: a study holding both levels takes precedence over a disagreement between studies, and `stores` names several", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("CT", { Lung: 3 })], B: [cat("CT", { Breast: 3 }, "sample")] },
      s2: { A: [cat("CT", { Lung: 2 })], B: [cat("CT", { Breast: 2 }, "sample")] },
    });
    const [r] = rowsOf(await run(["CT"], c));
    assert.equal(r.skipped, "s1, s2 store it both per patient and per sample; its counts would mix patients with samples");
    const { c: one } = ctx(two, {
      s1: { A: [cat("CT", { Lung: 3 })], B: [cat("CT", { Breast: 3 }, "sample")] },
      s2: { A: [cat("CT", { Lung: 2 }, "sample")], B: [cat("CT", { Breast: 2 }, "sample")] },
    });
    const [o] = rowsOf(await run(["CT"], one));
    assert.equal(o.skipped, "s1 stores it both per patient and per sample; its counts would mix patients with samples");
  });

  test("A9: a refused attribute beside a testable one — the testable one is tested, q over it alone", async () => {
    // CT alone in s1/s2 at patient level: A Lung 3 / Breast 1 vs B 1 / 3 → p 0.1573, and q = p with one tested
    const { c } = ctx(two, {
      s1: { A: [cat("CT", { Lung: 3, Breast: 1 }), cat("HISTOLOGY", { x: 3 })], B: [cat("CT", { Lung: 1, Breast: 3 }), cat("HISTOLOGY", { y: 3 })] },
      s2: { A: [cat("HISTOLOGY", { x: 1, y: 1 }, "sample")], B: [cat("HISTOLOGY", { y: 2 }, "sample")] },
    });
    const v = await run(["HISTOLOGY", "CT"], c);
    const rows = rowsOf(v);
    const ct = rows.find((r) => r.attribute === "CT")!;
    const h = rows.find((r) => r.attribute === "HISTOLOGY")!;
    assert.equal(h.skipped, levels("s1", "s2"));
    assert.equal(h.q, undefined);
    near(ct.p, 0.1573);
    assert.equal(ct.q, ct.p, "one tested attribute: q is p");
    assert.match(v.note!, /across the 1 tested attributes/);
  });

  test("A10: an empty default answer carries no level — refused by the value-holding ones; the row's per from the first value-holding answer", async () => {
    // s1/A empty (default per: patient), s1/B per sample with values, s2/A and s2/B per patient with values
    const { c } = ctx(two, {
      s1: { A: [cat("HISTOLOGY", {})], B: [cat("HISTOLOGY", { x: 2, y: 1 }, "sample")] },
      s2: { A: [cat("HISTOLOGY", { x: 1, y: 3 })], B: [cat("HISTOLOGY", { x: 3, y: 1 })] },
    });
    const [r] = rowsOf(await run(["HISTOLOGY"], c));
    assert.equal(r.skipped, levels("s2", "s1"));
    assert.equal(r.p, undefined);
    assert.equal(r.per, "patient", "s2/A's level, the first answer holding values in view order");
  });

  test("A10 variant: s2 holding sample values instead → tested, per sample (never the empty answer's patient)", async () => {
    const { c } = ctx(two, {
      s1: { A: [cat("HISTOLOGY", {})], B: [cat("HISTOLOGY", { x: 2, y: 1 }, "sample")] },
      s2: { A: [cat("HISTOLOGY", { x: 1, y: 3 }, "sample")], B: [cat("HISTOLOGY", { x: 3, y: 1 }, "sample")] },
    });
    const [r] = rowsOf(await run(["HISTOLOGY"], c));
    assert.equal(r.skipped, undefined);
    assert.ok(r.p != null);
    assert.equal(r.per, "sample");
  });

  test("A11: allAttributes — a hidden attribute refused for levels is not a row, but the note names it with the reason", async () => {
    // both studies declare OS_MONTHS, OS_STATUS (a survival pair: tested, not listed) and AGE
    const { c } = ctx(two, {
      s1: {
        A: [num("OS_MONTHS", [1, 2, 3]), cat("OS_STATUS", { x: 2, y: 2 }), num("AGE", [1, 2, 3])],
        B: [num("OS_MONTHS", [4, 5, 6]), cat("OS_STATUS", { x: 1, y: 3 }), num("AGE", [4, 5, 6])],
      },
      s2: {
        A: [num("OS_MONTHS", [2, 3], "sample"), cat("OS_STATUS", { x: 1 }), num("AGE", [2, 3])],
        B: [num("OS_MONTHS", [5, 7], "sample"), cat("OS_STATUS", { y: 1 }), num("AGE", [5, 7])],
      },
    });
    for (const r of Object.values(c.resolvers as Record<string, any>)) {
      r.viewAggregate = async () => [];
      r.viewMeta = async () => [{ a: "OS_MONTHS", label: "Overall Survival (Months)" }, { a: "OS_STATUS", label: "Overall Survival Status" }, { a: "AGE", label: "Age" }];
    }
    const res = await runClinical({ kind: "clinical", allAttributes: true } as never, c);
    const v = res instanceof Untimed ? res.result : res;
    const rows = rowsOf(v);
    assert.equal(rows.find((r) => r.attribute === "OS_MONTHS"), undefined, "a hidden attribute is never a row");
    assert.deepEqual(rows.map((r) => r.attribute), ["AGE"]);
    assert.ok(rows[0].p != null, "AGE is tested");
    assert.match(v.note!, /OS_MONTHS/);
    assert.ok(v.note!.includes(levels("s1", "s2")), v.note!);
  });
});
