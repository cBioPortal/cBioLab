// The method record (lib/method.ts): what it says was done must be what the fit was given —
// the counts, the reference levels and why, the conditional steps, and a Python script that
// codes each term the way the fit did.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coxMethod, logisticMethod, survivalMethod, compareMethod, cooccurrenceMethod, clinicalMethod, coexpressionMethod, diffexprMethod, GSEA_NULL_PY, INLINE_ROWS_MAX, type CoxTrace, type LogisticTrace, type SurvivalTrace } from "../lib/method.ts";
import type { CoxCovariate } from "../lib/types.ts";

const tp53: CoxCovariate = { source: "alteration", gene: "TP53", by: "mutated" };
const gender: CoxCovariate = { source: "clinical", attribute: "GENDER" };
const age: CoxCovariate = { source: "clinical", attribute: "AGE" };

function coxTrace(over: Partial<CoxTrace> = {}): CoxTrace {
  return {
    perStudy: [{ study: "s1", cohortPatients: 10, rows: 8 }],
    covariates: [tp53, gender, age],
    kinds: ["cat", "cat", "num"],
    columns: [
      { axisIndex: 0, label: "TP53 mutation status: Mutated", reference: "Not mutated", level: "Mutated" },
      { axisIndex: 1, label: "GENDER: Male", reference: "Female", level: "Male" },
      { axisIndex: 2, label: "AGE" },
    ],
    x: [[1, 0, 60], [1, 1, 61], [0, 1, 62], [0, 0, 63], [1, 0, 64], [0, 0, 65], [0, 1, 66], [0, 0, 67]],
    fit: { n: 8, events: 5, iterations: 5, loglik: -9.87654 },
    censoredAtCutoff: 0, droppedBadTime: 0,
    ...over,
  };
}
const coxOpts = { endpoint: "OS", monthsColumn: "OS_MONTHS", statusColumn: "OS_STATUS", stratifyByStudy: false, queryLabel: "coxRows:OS" };
const step = (m: ReturnType<typeof coxMethod>, title: RegExp) => m.steps.find((s) => title.test(s.title));
const param = (s: { params?: [string, string][] } | undefined, k: string) => s?.params?.find(([key]) => key === k)?.[1];

describe("coxMethod", () => {
  test("the fetch step counts cohort patients in and rows out, and says how events are read", () => {
    const fetch = step(coxMethod([coxTrace()], coxOpts), /^Fetch/)!;
    assert.equal(fetch.scope, "s1");
    assert.equal(fetch.rowsIn, 10);
    assert.equal(fetch.rowsOut, 8);
    assert.match(fetch.detail, /2 cohort patients had no row/);
    assert.match(fetch.detail, /OS_STATUS starting with “1”/);
    assert.match(fetch.detail, /missing one, is censored/);
  });

  test("each coded term carries its 0/1 count and the reason for its reference level", () => {
    const coding = step(coxMethod([coxTrace()], coxOpts), /^Code the covariates/)!;
    assert.match(param(coding, "TP53 mutation status: Mutated")!, /3 of 8 patients · reference “Not mutated”: the fixed default for a mutated-vs-not axis/);
    assert.match(param(coding, "GENDER: Male")!, /3 of 8 patients · reference “Female”: the most frequent level/);
    assert.match(param(coding, "AGE")!, /^numeric/);
  });

  test("a declared reference is named as declared; one never observed says what it fell back to", () => {
    const declared = coxTrace({ covariates: [tp53, { ...gender, reference: "Female" }, age] });
    assert.match(param(step(coxMethod([declared], coxOpts), /^Code/), "GENDER: Male")!, /declared in the view/);
    const missing = coxTrace({ covariates: [tp53, { ...gender, reference: "Other" }, age] });
    assert.match(param(step(coxMethod([missing], coxOpts), /^Code/), "GENDER: Male")!, /declared “Other” was never observed, so the most frequent level/);
  });

  test("the censoring and invalid-time steps appear only when they did something to the data", () => {
    const plain = coxMethod([coxTrace()], coxOpts);
    assert.equal(step(plain, /^Censor/), undefined);
    assert.equal(step(plain, /^Drop/), undefined);
    const cut = coxMethod([coxTrace({ censoredAtCutoff: 3, droppedBadTime: 1 })], { ...coxOpts, cutoffMonths: 60 });
    assert.match(step(cut, /^Censor at 60 months/)!.detail, /^3 patients followed past 60 months/);
    assert.equal(step(cut, /^Drop/)!.rowsOut, 7);
    assert.match(cut.python, /df\.loc\[df\["m"\] > 60, "ev"\] = 0/);
  });

  test("the statistic step reports the fit as it went, including a fit that did not converge", () => {
    const ok = step(coxMethod([coxTrace()], coxOpts), /^Fit/);
    assert.equal(param(ok, "patients / events"), "8 / 5");
    assert.equal(param(ok, "fit"), "converged in 5 iterations");
    assert.equal(param(ok, "log partial likelihood"), "-9.8765");
    const stuck = step(coxMethod([coxTrace({ fit: { n: 8, events: 5, iterations: 25, loglik: -9 } })], coxOpts), /^Fit/);
    assert.match(param(stuck, "fit")!, /without converging/);
    assert.match(param(step(coxMethod([coxTrace()], { ...coxOpts, stratifyByStudy: true }), /^Fit/), "baseline hazard")!, /one per study/);
  });

  test("the Python script codes every term exactly as the fit did", () => {
    const m = coxMethod([coxTrace()], coxOpts);
    assert.match(m.python, /dtype=\{"c0": str, "c1": str\}/);
    assert.match(m.python, /"TP53 mutation status: Mutated": \(df\["c0"\] == "Mutated"\)\.astype\(float\),  # reference: Not mutated/);
    assert.match(m.python, /"GENDER: Male": \(df\["c1"\] == "Male"\)\.astype\(float\)/);
    assert.match(m.python, /"AGE": df\["c2"\]\.astype\(float\)/);
    assert.doesNotMatch(m.python, /strata=/);
    assert.match(coxMethod([coxTrace()], { ...coxOpts, stratifyByStudy: true }).python, /strata=\["study"\]/);
  });

  test("per-cohort fits get one scoped block each, saved under the cohort's name", () => {
    const m = coxMethod([coxTrace({ scope: "MSI-high" }), coxTrace({ scope: "MSS" })], coxOpts);
    assert.deepEqual(m.steps.filter((s) => s.kind === "statistic").map((s) => s.scope), ["MSI-high", "MSS"]);
    assert.equal(m.steps.find((s) => s.kind === "fetch")!.scope, "MSI-high · s1");
    assert.match(m.python, /cox_rows_MSI_high\.csv/);
    assert.match(m.python, /fits\["MSS"\] = cph/);
  });

  test("it names the code that ran and what it is verified against", () => {
    const m = coxMethod([coxTrace()], coxOpts);
    assert.deepEqual(m.implementation.functions, ["coxRegression"]);
    assert.equal(m.implementation.file, "lib/stats.ts");
    assert.match(m.verification!, /lifelines 0\.30\.3 CoxPHFitter \(Efron ties\)/);
  });
});

describe("logisticMethod", () => {
  const trace = (over: Partial<LogisticTrace> = {}): LogisticTrace => ({
    perStudy: [{ study: "s1", cohortPatients: 5, rows: 5 }],
    covariates: [tp53], kinds: ["cat"],
    columns: [{ axisIndex: 0, label: "TP53 mutation status: Mutated", reference: "Not mutated", level: "Mutated" }],
    x: [[1], [0], [1], [0], [0]],
    fit: { n: 5, events: 2, iterations: 6, loglik: -3.2 },
    outcomeKind: "cat", outcomeEvent: "Yes", outcomeOther: ["No", "Unknown"],
    ...over,
  });

  test("a categorical outcome says which value is the event and which values were folded into not-event", () => {
    const m = logisticMethod(trace(), { outcomeLabel: "RESPONSE", queryLabel: "logisticRows" });
    const outcome = m.steps.find((s) => s.title === "Code the outcome")!;
    assert.match(outcome.detail, /1 if RESPONSE = “Yes”, else 0 — every other observed value \(No, Unknown\) counts as not the event/);
    assert.match(m.python, /y = \(df\["y"\] == "Yes"\)\.astype\(int\)/);
    assert.match(m.python, /dtype=\{"y": str, "c0": str\}/);
    assert.match(m.python, /sm\.Logit\(y, sm\.add_constant\(X\)\)/);
  });

  test("a numeric outcome is used as is", () => {
    const m = logisticMethod(trace({ outcomeKind: "num", outcomeEvent: undefined, outcomeOther: [] }), { outcomeLabel: "FLAG", queryLabel: "logisticRows" });
    assert.match(m.steps.find((s) => s.title === "Code the outcome")!.detail, /already coded 0\/1/);
    assert.match(m.python, /y = df\["y"\]\.astype\(int\)/);
    assert.match(m.python, /dtype=\{"c0": str\}/);
  });
});

describe("survivalMethod", () => {
  const trace = (over: Partial<SurvivalTrace> = {}): SurvivalTrace => ({
    endpoint: "OS", monthsColumn: "OS_MONTHS", statusColumn: "OS_STATUS", queryLabel: "survivalCounts:OS",
    beyondCutoff: 0, display: "survival",
    cohorts: [
      { name: "A, mutant", n: 3, events: 2, median: 5, perStudy: [{ study: "s1", cohortPatients: 4, patients: 3, rows: 2 }] },
      { name: "B", n: 2, events: 1, median: null, perStudy: [{ study: "s1", cohortPatients: 2, patients: 2, rows: 2 }] },
    ],
    counts: [
      { cohort: "A, mutant", study: "s1", months: 5, event: 1, n: 2 }, { cohort: "A, mutant", study: "s1", months: 9, event: 0, n: 1 },
      { cohort: "B", study: "s1", months: 4, event: 1, n: 1 }, { cohort: "B", study: "s1", months: 12, event: 0, n: 1 },
    ],
    test: { kind: "logrank", stratified: false, strata: 1, chi2: 1.2345, df: 1, p: 0.27 },
    ...over,
  });

  test("one fetch step per cohort and study, with patients in and out", () => {
    const m = survivalMethod(trace());
    const fetches = m.steps.filter((s) => s.kind === "fetch");
    assert.deepEqual(fetches.map((s) => s.scope), ["A, mutant · s1", "B · s1"]);
    assert.match(fetches[0].detail, /1 cohort patient had no OS_MONTHS value/);
    assert.equal(fetches[0].rowsOut, 3);
  });

  test("the script carries the counts, quoting a cohort name with a comma, and expands them to patients", () => {
    const m = survivalMethod(trace());
    assert.match(m.python, /cohort,study,months,event,n\n"A, mutant",s1,5,1,2\n/);
    assert.match(m.python, /counts\.index\.repeat\(counts\["n"\]\)/);
    assert.match(m.python, /survdiff\(df\["months"\], df\["event"\], df\["cohort"\]\)/);
    assert.match(m.python, /chi2_dist\.sf\(chi2, 1\)/);
  });

  test("a stratified test runs both the stratified and the pooled log-rank", () => {
    const m = survivalMethod(trace({ test: { kind: "logrank", stratified: true, strata: 2, chi2: 3, df: 1, p: 0.08, pooled: { chi2: 5, p: 0.02 } } }));
    assert.match(m.steps.at(-1)!.title, /stratified by study/);
    assert.match(m.python, /strata=df\["study"\]/);
    assert.match(m.python, /log-rank, pooled/);
  });

  test("a refused test says why, and the script fits only the curves", () => {
    const m = survivalMethod(trace({ test: { kind: "none", reason: "Refused: B (n=2) has fewer than 10 patients." } }));
    assert.equal(m.steps.at(-1)!.title, "No log-rank test");
    assert.doesNotMatch(m.python, /survdiff\(/);
  });

  test("delayed entry reaches both the fit and the test", () => {
    const m = survivalMethod(trace({ anchor: "first Treatment",
      counts: trace().counts.map((r) => ({ ...r, entry: 1 })) }));
    assert.match(m.steps.find((s) => s.title.startsWith("Estimate"))!.detail, /delayed entry: re-anchored to first Treatment/);
    assert.match(m.python, /entry=g\["entry"\]/);
    assert.match(m.python, /entry=df\["entry"\]/);
  });

  test("past the inline limit the script names a file to export instead of embedding the table", () => {
    const big = Array.from({ length: INLINE_ROWS_MAX + 1 }, (_, i) => ({ cohort: "A, mutant", study: "s1", months: i, event: 0, n: 1 }));
    const m = survivalMethod(trace({ counts: big }));
    assert.match(m.python, /too many to include here: export them as survival_counts\.csv/);
    assert.doesNotMatch(m.python, /io\.StringIO/);
  });
});

describe("compareMethod", () => {
  const counts = [
    { cohort: "A", study: "s1", gene: "TP53", profiled: 10, altered: 4, driver: 3 },
    { cohort: "A", study: "s2", gene: "TP53", profiled: 5, altered: 1, driver: 1 },
    { cohort: "B", study: "s1", gene: "TP53", profiled: 8, altered: 1, driver: 0 },
  ];
  const base = { oncokbPin: "v4.20", genes: ["TP53"], counts,
    perSite: [{ cohort: "A", study: "s1", cohortPatients: 12 }, { cohort: "A", study: "s2", cohortPatients: 6 }, { cohort: "B", study: "s1", cohortPatients: 9 }] };

  test("two cohorts: Fisher per gene, then BH, and the pooling across studies is stated", () => {
    const m = compareMethod({ ...base, cohorts: ["A", "B"] });
    assert.deepEqual(m.steps.map((s) => s.title).slice(-3), ["Sum each cohort's counts across its studies", "Fisher's exact test per gene", "Benjamini–Hochberg across genes"]);
    assert.match(m.steps[0].detail, /OncoKB release pinned for this run \(v4\.20\)/);
    assert.match(m.python, /fisher_exact\(\[\[a, pa - a\], \[b, pb - b\]\], alternative="two-sided"\)/);
    assert.match(m.python, /A,s2,TP53,5,1,1/);
    assert.deepEqual(m.implementation.functions, ["fisherExact", "benjaminiHochberg"]);
  });

  test("three cohorts: an uncorrected chi-squared on 2 df", () => {
    const m = compareMethod({ ...base, cohorts: ["A", "B", "C"] });
    assert.equal(m.steps.find((s) => s.title === "Pearson χ² test per gene")!.params!.find(([k]) => k === "df")![1], "2");
    assert.match(m.python, /chi2_contingency\(table\.to_numpy\(\), correction=False\)/);
  });

  test("one cohort: no test, and no verification claim", () => {
    const m = compareMethod({ ...base, cohorts: ["A"], perSite: base.perSite.slice(0, 1), counts: counts.slice(0, 1) });
    assert.equal(m.steps.at(-1)!.title, "No test");
    assert.equal(m.verification, undefined);
  });

  test("with no OncoKB pin it says nothing counts as a driver", () => {
    assert.match(compareMethod({ ...base, oncokbPin: null, cohorts: ["A", "B"] }).steps[0].detail, /no OncoKB release is pinned/);
  });
});

describe("cooccurrenceMethod", () => {
  const counts = [
    { study: "s1", a: "TP53", b: "KRAS", both: 3, onlyA: 5, onlyB: 4, neither: 20 },
    { study: "s2", a: "TP53", b: "KRAS", both: 1, onlyA: 2, onlyB: 6, neither: 9 },
  ];
  test("one study: Fisher, then BH over the assessable pairs; pairs no panel covers are named as set aside", () => {
    const m = cooccurrenceMethod({ cohort: "C", cohortPatients: [{ study: "s1", patients: 40 }], counts: counts.slice(0, 1), pairs: 3, assessable: 1 });
    assert.deepEqual(m.steps.map((s) => s.title), ["Count each gene pair's 2×2 table", "Set aside pairs no panel covers",
      "Log₂ odds ratio per pair", "Fisher's exact test per pair", "Benjamini–Hochberg across pairs"]);
    assert.match(m.steps[0].detail, /mutation panel covering both genes/);
    assert.doesNotMatch(m.python, /StratifiedTable/);
    assert.match(m.python, /p = result\["p_fisher"\]/);
  });
  test("several studies: CMH stratified by study ranks the pairs, with R's continuity rule and the p from the chi-squared tail", () => {
    const m = cooccurrenceMethod({ cohort: "C", cohortPatients: [{ study: "s1", patients: 40 }, { study: "s2", patients: 20 }], counts, pairs: 1, assessable: 1 });
    assert.match(m.steps.find((s) => s.kind === "statistic" && /Mantel/.test(s.title))!.detail, /\|Σa − ΣE\[a\]\| ≥ 0\.5/);
    assert.match(m.python, /correction=bool\(delta >= 0\.5\)/);
    assert.match(m.python, /chi2_dist\.sf\(stat, 1\)/);
    assert.match(m.python, /p = result\["p_cmh"\]/);
    assert.ok(m.implementation.functions.includes("cochranMantelHaenszel"));
  });
});

describe("clinicalMethod", () => {
  const base = {
    cohorts: ["A", "B"], singleStudy: true,
    perSite: [{ cohort: "A", study: "s1", cohortPatients: 10 }, { cohort: "B", study: "s1", cohortPatients: 12 }],
    attributes: [
      { attribute: "AGE", per: "patient" as const, kind: "num" as const, test: "Welch t", statistic: -2.1, df: 19.5, p: 0.049, q: 0.098, rankStatistic: 30, rankP: 0.06 },
      { attribute: "SEX", per: "patient" as const, kind: "cat" as const, test: "chi-squared", statistic: 0.4, df: 1, p: 0.52, q: 0.52, distinct: 2, minExpected: 4.5 },
      { attribute: "BOGUS", per: "patient" as const, kind: "cat" as const, skipped: "not declared by s1" },
    ],
    categorical: [{ cohort: "A", study: "s1", attribute: "SEX", value: "Male", n: 6 }, { cohort: "B", study: "s1", attribute: "SEX", value: "Female", n: 7 }],
    numeric: [{ cohort: "A", study: "s1", attribute: "AGE", n: 10, sum: 600, sumsq: 36500 }, { cohort: "B", study: "s1", attribute: "AGE", n: 12, sum: 780, sumsq: 51000 }],
    histograms: [{ cohort: "A", attribute: "AGE", value: 60, n: 10 }, { cohort: "B", attribute: "AGE", value: 65, n: 12 }],
  };

  test("single study, two cohorts: chi-squared, Welch t, Mann-Whitney alongside, BH; skipped attributes named", () => {
    const m = clinicalMethod(base);
    assert.deepEqual(m.steps.map((s) => s.title).slice(2), ["Set aside attributes that cannot be tested", "Pearson χ² for each categorical attribute",
      "Welch's t-test for each numeric attribute", "Mann–Whitney U alongside", "Benjamini–Hochberg across attributes"]);
    assert.deepEqual(m.steps[2].params, [["BOGUS", "not declared by s1"]]);
    assert.match(m.python, /from scipy\.stats import chi2_contingency, mannwhitneyu, ttest_ind_from_stats/);
    assert.match(m.python, /m\["var"\] = \(\(m\["sumsq"\] - m\["sum"\] \*\* 2 \/ m\["n"\]\) \/ \(m\["n"\] - 1\)\)\.clip\(lower=0\)/);
    assert.match(m.python, /np\.repeat\(h\["value"\]/);
  });

  test("several studies, three cohorts: moments summed, Welch's ANOVA, and no rank tests or medians", () => {
    const m = clinicalMethod({ ...base, cohorts: ["A", "B", "C"], singleStudy: false, histograms: [],
      attributes: [{ ...base.attributes[0], test: "Welch ANOVA", df: 2, df2: 30.2, rankStatistic: undefined, rankP: undefined }] });
    assert.ok(m.steps.some((s) => s.title === "Add each cohort's counts and moments across its studies"));
    assert.ok(!m.steps.some((s) => /alongside/.test(s.title)));
    assert.match(m.python, /anova_generic\(/);
    assert.doesNotMatch(m.python, /^from scipy\.stats import\s*$/m);
    assert.doesNotMatch(m.python, /kruskal|mannwhitneyu/);
  });
});

describe("coexpressionMethod", () => {
  const sums = [{ study: "s1", a: "ERBB2", b: "GRB7", n: 50, sx: 1, sy: 2, sxy: 40, sxx: 49, syy: 52 },
    { study: "s2", a: "ERBB2", b: "GRB7", n: 30, sx: -1, sy: 0, sxy: 20, sxx: 29, syy: 31 }];
  test("one study: Pearson from the sums, then BH on its p", () => {
    const m = coexpressionMethod({ cohort: "C", profileType: "mrna_z", cohortPatients: [{ study: "s1", patients: 60 }], sums: sums.slice(0, 1), pairs: 1, tested: 1 });
    assert.deepEqual(m.steps.map((s) => s.title), ["Sum each gene pair's values", "Pearson correlation per pair", "Benjamini–Hochberg across pairs"]);
    assert.doesNotMatch(m.python, /combine_effects/);
    assert.match(m.python, /p = tested\["p"\]/);
  });
  test("several studies: summed for the pooled r, and a fixed-effect Fisher-z meta-analysis is the p that is corrected", () => {
    const m = coexpressionMethod({ cohort: "C", profileType: "mrna_z", cohortPatients: [{ study: "s1", patients: 60 }, { study: "s2", patients: 40 }], sums, pairs: 1, tested: 1 });
    assert.ok(m.steps.some((s) => s.title === "Add the six sums across studies"));
    assert.match(m.steps.find((s) => s.title === "Fisher-z meta-analysis across studies")!.detail, /weighted by n − 3/);
    assert.match(m.python, /combine_effects\(z, var/);
    assert.match(m.python, /row\.update\(r_meta=None, p_meta=1\.0\)/);
    assert.match(m.python, /p = tested\["p_meta"\]\.fillna\(tested\["p"\]\)/);
  });
});

describe("diffexprMethod", () => {
  const base = { profileType: "mrna_z", log2: false, groups: ["A", "B"] as [string, string], minN: 3, tested: 2, skipped: 1,
    perSite: [{ cohort: "A", study: "s1", cohortPatients: 10 }, { cohort: "B", study: "s1", cohortPatients: 12 }],
    moments: [{ cohort: "A", gene: "ESR1", n: 10, sx: 5, sxx: 9 }, { cohort: "B", gene: "ESR1", n: 12, sx: 20, sxx: 40 }] };
  test("Welch per gene with the same no-variance rule and a clamped variance, then BH", () => {
    const m = diffexprMethod(base);
    assert.deepEqual(m.steps.map((s) => s.title), ["Sum every gene's values", "Sum every gene's values", "Leave out genes that cannot be tested",
      "Welch's t-test per gene", "Benjamini–Hochberg across genes"]);
    assert.match(m.python, /1e-9 \* \(1 \+ g\["mean_a"\] \*\* 2 \+ g\["mean_b"\] \*\* 2\)/);
    assert.match(m.python, /\.clip\(lower=0\)/);
    assert.doesNotMatch(m.python, /preranked_gsea/);
  });
  test("with enrichment, the script carries the seeded-null port verbatim and the sets that were tested", () => {
    const m = diffexprMethod({ ...base, gsea: { sets: [{ name: "HALLMARK_X", genes: ["ESR1", "PGR"] }], tested: 1, skipped: [], permutations: 1000, minSize: 10 } });
    assert.ok(m.python.includes(GSEA_NULL_PY.trimEnd()));
    assert.match(m.python, /HALLMARK_X/);
    assert.match(m.python, /preranked_gsea\(ranked, sets, permutations=1000, min_size=10\)/);
  });
});
