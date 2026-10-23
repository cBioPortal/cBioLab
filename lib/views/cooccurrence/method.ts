// The cooccurrence view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, ALTERED_MEANING, plural, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CooccurrenceTrace {
  cohort: string;
  cohortPatients: { study: string; patients: number }[];
  /** the four counts each study returned per pair */
  counts: { study: string; a: string; b: string; both: number; onlyA: number; onlyB: number; neither: number }[];
  pairs: number;
  assessable: number;
  /** what the view reported per assessable pair — for the script check */
  results: { a: string; b: string; p: number; q: number; pStratified?: number }[];
}

export function cooccurrenceMethod(t: CooccurrenceTrace): MethodRecord {
  const stratified = t.cohortPatients.length > 1;
  const steps: MethodStep[] = t.cohortPatients.map((s) => ({
    kind: "fetch" as const, title: "Count each gene pair's 2×2 table",
    detail: "The pairCounts query above. Of the patients with a sample on a mutation panel covering both genes: how many are altered in both, only the first, only the second, or neither (" +
      ALTERED_MEANING + "). Four counts per pair, nothing else.",
    scope: t.cohort + " · " + s.study, rowsIn: s.patients,
    params: [["pairs", String(t.pairs)]],
  }));
  if (t.assessable < t.pairs) {
    steps.push({ kind: "transform", title: "Set aside pairs no panel covers",
      detail: plural(t.pairs - t.assessable, "pair") + " had no patient profiled for both genes — no denominator, so no test; they are omitted rather than reported as p = 1.",
      rowsIn: t.pairs, rowsOut: t.assessable });
  }
  steps.push({ kind: "statistic", title: "Log₂ odds ratio per pair",
    detail: "log₂((both · neither) / (only first · only second)) on the counts summed across studies, with 0.5 added to every cell when any cell is 0." +
      (stratified ? " The direction reported (co-occurrence vs mutual exclusivity) follows the Mantel–Haenszel odds ratio below." : "") });
  steps.push(stratified
    ? { kind: "statistic", title: "Cochran–Mantel–Haenszel test, stratified by study",
        detail: "Each study's 2×2 is a stratum (one with an empty margin says nothing and is dropped); the test of a common odds ratio of 1, with the 0.5 continuity correction applied when |Σa − ΣE[a]| ≥ 0.5 (as R's mantelhaen.test), on 1 df. This p is the one corrected and ranked; the two-sided Fisher p on the pooled counts is reported alongside." }
    : { kind: "statistic", title: "Fisher's exact test per pair", detail: "Two-sided, on the pair's 2×2 table." });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across pairs",
    detail: "q-values over the " + t.assessable + " assessable pairs, from the " + (stratified ? "stratified" : "Fisher") + " p-values." });
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version +
      " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import fisher_exact",
    ...(stratified ? ["from scipy.stats import chi2 as chi2_dist", "from statsmodels.stats.contingency_tables import StratifiedTable"] : []),
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the pairCounts query returned for each study, cohort " + JSON.stringify(t.cohort),
      ["study", "a", "b", "both", "only_a", "only_b", "neither"],
      t.counts.map((r) => [r.study, r.a, r.b, r.both, r.onlyA, r.onlyB, r.neither]), "pair_counts.csv"),
    "",
    "def log2_or(a, b, c, d):",
    "    if 0 in (a, b, c, d):",
    "        a, b, c, d = a + 0.5, b + 0.5, c + 0.5, d + 0.5",
    "    return np.log2(a * d / (b * c))",
    "",
    "rows = []",
    "for (a, b), g in counts.groupby([\"a\", \"b\"], sort=False):",
    "    s = g[[\"both\", \"only_a\", \"only_b\", \"neither\"]].sum()",
    "    if s.sum() == 0:",
    "        continue  # no patient profiled for both genes: not assessable",
    "    row = {\"a\": a, \"b\": b, \"log2_or\": log2_or(*s),",
    "           \"p_fisher\": fisher_exact([[s.both, s.only_a], [s.only_b, s.neither]], alternative=\"two-sided\").pvalue}",
    ...(stratified ? [
      "    strata = [np.array([[r.both, r.only_a], [r.only_b, r.neither]], dtype=float) for r in g.itertuples()",
      "              if min(r.both + r.only_a, r.only_b + r.neither, r.both + r.only_b, r.only_a + r.neither) > 0]",
      "    if strata:",
      "        st = StratifiedTable(strata)",
      "        expected = sum(t[0].sum() * t[:, 0].sum() / t.sum() for t in strata)",
      "        delta = abs(sum(t[0, 0] for t in strata) - expected)",
      "        stat = st.test_null_odds(correction=bool(delta >= 0.5)).statistic  # R's continuity-correction rule",
      "        row[\"p_cmh\"] = chi2_dist.sf(stat, 1)  # from the tail directly: test_null_odds' own p is 0 below about 1e-16",
      "        row[\"or_mh\"] = st.oddsratio_pooled",
      "    else:",
      "        row[\"p_cmh\"] = 1.0",
    ] : []),
    "    rows.append(row)",
    "",
    "result = pd.DataFrame(rows)",
    "p = result[\"" + (stratified ? "p_cmh" : "p_fisher") + "\"]",
    "result[\"q\"] = multipletests(p, method=\"fdr_bh\")[1]",
    "print(result.sort_values(\"" + (stratified ? "p_cmh" : "p_fisher") + "\").to_string(index=False))",
    "for r in result.itertuples():",
    "    RESULT[f\"cooccurrence:{r.a}/{r.b}:p\"], RESULT[f\"cooccurrence:{r.a}/{r.b}:q\"] = r.p_fisher, r.q",
    ...(stratified ? ["    RESULT[f\"cooccurrence:{r.a}/{r.b}:p_cmh\"] = r.p_cmh"] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["fisherExact", ...(stratified ? ["cochranMantelHaenszel"] : []), "log2OddsRatio", "benjaminiHochberg"],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact" +
      (stratified ? ", the CMH test and Mantel–Haenszel odds ratio statsmodels " + VERIFIED.cmh.version + " " + VERIFIED.cmh.fn : "") +
      " and Benjamini–Hochberg statsmodels " + VERIFIED.bh.version + " " + VERIFIED.bh.fn + ", to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: checks("cooccurrence:", t.results, (r) => r.a + "/" + r.b, [["p", "p"], ["q", "q"], ["pStratified", "p_cmh"]]),
  };
}
