// What /verification says about the statistics: each method the views report, the independent
// library it is checked against, how closely the two must agree, and the choices a statistician
// would want to review. The library versions come from VERIFIED (lib/method.ts), the same constants
// every view's method record quotes, and test/verification.test.ts fails if a method in VERIFIED
// is missing here or names a test file that does not exist, so this page cannot fall behind them.
import { VERIFIED } from "./method.ts";

type VerifiedKey = keyof typeof VERIFIED;

export interface StatCheck {
  /** the method, as a results reader knows it */
  method: string;
  /** where it shows up in the app */
  usedFor: string;
  /** VERIFIED entries this row covers */
  keys: VerifiedKey[];
  /** how closely our numbers must match the library's, in words */
  agreement: string;
  /** the test that asserts it, and the fixture (test/fixtures/golden/<fixture>.json) and keys it reads */
  test: string;
  fixture: string;
  caseKeys: string[];
}

export const STAT_CHECKS: StatCheck[] = [
  { method: "Kaplan–Meier survival curves", usedFor: "survival view", keys: ["km"],
    agreement: "every step of every curve to 4 decimal places (the precision the curves are shown at)",
    test: "test/survival-golden.test.ts", fixture: "survival", caseKeys: ["km"] },
  { method: "Log-rank test (two or more groups, stratified, delayed entry)", usedFor: "survival view", keys: ["logrank"],
    agreement: "p-values to 6 significant digits",
    test: "test/survival-golden.test.ts", fixture: "survival", caseKeys: ["logrank"] },
  { method: "Cox proportional-hazards regression", usedFor: "Cox view, hazard ratios", keys: ["cox"],
    agreement: "coefficients, standard errors, p-values and confidence intervals to 6 significant digits",
    test: "test/regression-golden.test.ts", fixture: "regression", caseKeys: ["cox"] },
  { method: "Logistic regression", usedFor: "logistic view, odds ratios", keys: ["logistic"],
    agreement: "coefficients, standard errors and p-values to 6 significant digits",
    test: "test/regression-golden.test.ts", fixture: "regression", caseKeys: ["logistic"] },
  { method: "Fisher's exact test, χ² test", usedFor: "gene comparisons, co-occurrence, clinical tables, the risk model's Table 1", keys: ["fisher", "chi2"],
    agreement: "p-values to 6 significant digits, including tables with zeros and very large counts",
    test: "test/tables-golden.test.ts", fixture: "tables", caseKeys: ["fisher", "chi2"] },
  { method: "Benjamini–Hochberg false discovery rate", usedFor: "every q-value", keys: ["bh"],
    agreement: "q-values to 6 significant digits, including tied and p = 1 values",
    test: "test/tables-golden.test.ts", fixture: "tables", caseKeys: ["bh"] },
  { method: "Cochran–Mantel–Haenszel test, McNemar's test", usedFor: "stratified and paired comparisons", keys: ["cmh", "mcnemar"],
    agreement: "p-values and odds ratios to 6 significant digits",
    test: "test/tables-golden.test.ts", fixture: "tables", caseKeys: ["cmh", "mcnemar"] },
  { method: "Welch's t-test, Welch's ANOVA, Mann–Whitney, Kruskal–Wallis, medians", usedFor: "comparing a clinical value between groups (the risk model's Table 1 among them); each part of a composition between cohorts", keys: ["welch", "anova", "ranks"],
    agreement: "p-values to 6 significant digits",
    test: "test/moments-golden.test.ts", fixture: "moments", caseKeys: ["welch", "anova", "ranks"] },
  { method: "Pearson correlation and its meta-analysis across studies", usedFor: "co-expression, scatter plots", keys: ["pearson", "meta"],
    agreement: "r and p to 6 significant digits",
    test: "test/moments-golden.test.ts", fixture: "moments", caseKeys: ["pearson", "meta"] },
  { method: "Cumulative incidence with competing risks", usedFor: "incidence view", keys: ["cif"],
    agreement: "every point and its standard error to 12 decimal places",
    test: "test/incidence-golden.test.ts", fixture: "incidence", caseKeys: ["cif", "entryCif", "gray"] },
  { method: "Gene-set enrichment (pre-ranked GSEA)", usedFor: "differential expression view", keys: ["gsea"],
    agreement: "enrichment scores to 4 decimal places against gseapy; permutation p-values exactly against the Python script each result ships with",
    test: "test/gsea-golden.test.ts", fixture: "gsea", caseKeys: ["expected"] },
];

/**
 * The elastic-net risk model is checked the same way, against scikit-survival and lifelines, but is
 * not one of VERIFIED's entries (its records name the libraries directly).
 */
export const COXNET_CHECK = {
  method: "Elastic-net Cox risk model", usedFor: "risk model view",
  reference: "scikit-survival, statsmodels and lifelines",
  agreement: "coefficients to 4 decimal places along the whole penalty path; unpenalised fits to 6 significant digits",
  test: "test/coxnet-golden.test.ts", fixture: "coxnet", caseKeys: ["cases"],
};

/**
 * Choices between defensible methods. Each is what the engine does and what its golden test pins;
 * none is a bug either way, but a reviewer should know which was made.
 */
export const JUDGMENT_CALLS: { choice: string; why: string }[] = [
  { choice: "Tied death times in Cox regression use Efron's method, not Breslow's.",
    why: "Efron is the default in R's survival package and in lifelines, and is more accurate with many ties (common when follow-up is recorded in whole months)." },
  { choice: "Fisher's exact test is two-sided, summing every table no more likely than the observed one.",
    why: "This is scipy's and R's definition. A one-sided test would halve many p-values." },
  { choice: "The χ² test has no continuity correction; the Cochran–Mantel–Haenszel test has one.",
    why: "Each matches the reference default (scipy without correction, R's mantelhaen.test with correction)." },
  { choice: "Group means are compared with Welch's test, which does not assume equal variances.",
    why: "Clinical values rarely have equal spread across cohorts; Student's t would be wrong when they do not." },
  { choice: "Multiple-testing correction is Benjamini–Hochberg (false discovery rate), not Bonferroni.",
    why: "The usual choice when screening many genes: it controls the share of false positives among the hits rather than the chance of any false positive at all." },
  { choice: "Survival with delayed entry (left truncation) removes patients from the at-risk group until they were observable.",
    why: "Patients sequenced years after diagnosis would otherwise make early survival look better than it was." },
  { choice: "A gene's frequency divides by samples whose panel covers that gene, not by every sample.",
    why: "A sample whose panel omits a gene is not profiled for it, so counting it as unaltered makes the gene look rarer. This matches cBioPortal." },
];
