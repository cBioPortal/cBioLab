// The composition view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import type { CompositionSource } from "../../composition.ts";
import type { CompositionCell } from "./types.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CompositionTrace {
  source: CompositionSource; sourceName: string; cohorts: string[]; unit: "samples" | "patients"; normalize: boolean; eps: number;
  perSite: { cohort: string; study: string; n: number }[];
  /** per cohort, summed over its studies: n, per part Σp and Σp², Σ and Σ² of entropy, cases left out */
  sums: { cohort: string; n: number; sx: number[]; sxx: number[]; hx: number; hxx: number; incomplete: number; invalid: number }[];
  /** what the view reported, for the script check */
  cells: CompositionCell[];
  two: boolean;
}

export function compositionMethod(t: CompositionTrace): MethodRecord {
  const one = t.unit.replace(/s$/, ""), parts = t.source.parts, k = parts.length;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum each part over the cohort's " + t.unit,
    detail: "The composition:moments query above: each " + one + "'s " + k + " parts read and put in part order inside the database; a " + one +
      " with every part, none below zero and a sum above zero is kept" + (t.normalize ? ", its parts divided by their sum" : "") +
      "; then over those " + t.unit + " n, Σp and Σp² per part, and Σ and Σ² of each one's Shannon entropy. No case's values leave the database in this query.",
    scope: s.cohort + " · " + s.study, rowsOut: s.n,
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's sums across its studies",
    detail: "The sums add exactly; there is no batch correction between studies." });
  if (t.cohorts.length >= 2) steps.push({ kind: "statistic", title: "Each cohort against the others pooled, per part; then Benjamini–Hochberg",
    detail: "The other cohorts' sums are added into one group. Effect: log2((mean + " + t.eps + ") / (others' mean + " + t.eps + ")). Test: Welch's unequal-variance t " +
      "from each side's n, mean and variance (Σp² − (Σp)²/n)/(n − 1), two-sided; not tested when either side has under 2 " + t.unit + " or neither has any spread. " +
      (t.two ? "With two cohorts each part's two cells are one comparison, corrected for once. " : "") + "q across every comparison tested.",
    params: [["comparisons", String(t.cells.filter((c) => c.p != null && (!t.two || c.cohort === t.cohorts[0])).length)]] });
  const file = "composition_moments.csv";
  const python = [
    "# Recompute with scipy " + VERIFIED.welch.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import ttest_ind_from_stats",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "cohorts = " + JSON.stringify(t.cohorts),
    "parts = " + JSON.stringify(parts),
    "EPS = " + t.eps,
    "TWO = " + (t.two ? "True" : "False"),
    ...pyTable("data", "Per cohort and part: how many " + t.unit + " have every part, and the sum and sum of squares of this part's value over them, from the composition:moments queries summed over each cohort's studies",
      ["cohort", "part", "n", "sx", "sxx"], t.sums.flatMap((s) => parts.map((p, j) => [s.cohort, p, s.n, s.sx[j], s.sxx[j]])), file),
    "def stats(n, sx, sxx):",
    "    mean = sx / n if n else 0.0",
    "    var = max(0.0, (sxx - sx ** 2 / n) / (n - 1)) if n >= 2 else 0.0",
    "    return mean, var",
    "rows = []",
    "for cohort in cohorts:",
    "    for part in parts:",
    "        a = data[(data[\"cohort\"] == cohort) & (data[\"part\"] == part)].iloc[0]",
    "        mean, var = stats(a[\"n\"], a[\"sx\"], a[\"sxx\"])",
    "        RESULT[f\"composition:{cohort}|{part}:mean\"] = mean",
    "        if len(cohorts) < 2:",
    "            continue",
    "        rest = data[(data[\"cohort\"] != cohort) & (data[\"part\"] == part)]",
    "        rn, rsx, rsxx = rest[\"n\"].sum(), rest[\"sx\"].sum(), rest[\"sxx\"].sum()",
    "        rmean, rvar = stats(rn, rsx, rsxx)",
    "        log2 = np.log2((mean + EPS) / (rmean + EPS))",
    "        RESULT[f\"composition:{cohort}|{part}:log2\"] = log2",
    "        if a[\"n\"] >= 2 and rn >= 2 and var + rvar > 0:",
    "            p = ttest_ind_from_stats(mean, np.sqrt(var), a[\"n\"], rmean, np.sqrt(rvar), rn, equal_var=False).pvalue",
    "            rows.append((cohort, part, p))",
    "res = pd.DataFrame(rows, columns=[\"cohort\", \"part\", \"p\"])",
    "tested = res[res[\"cohort\"] == cohorts[0]] if TWO else res  # two cohorts: one comparison per part",
    "if len(tested):",
    "    q = dict(zip(tested[\"part\"] + \"|\" + tested[\"cohort\"], multipletests(tested[\"p\"], method=\"fdr_bh\")[1]))",
    "    for r in res.itertuples():",
    "        RESULT[f\"composition:{r.cohort}|{r.part}:p\"] = r.p",
    "        RESULT[f\"composition:{r.cohort}|{r.part}:q\"] = q[r.part + \"|\" + (cohorts[0] if TWO else r.cohort)]",
    "print(res.assign(q=[RESULT.get(f\"composition:{c}|{p}:q\") for c, p in zip(res[\"cohort\"], res[\"part\"])]).sort_values(\"p\").head(30).to_string(index=False))",
    "RESULT[\"composition:tested\"] = len(tested)",
  ].join("\n") + "\n";
  const tol = { rel: 1e-6, abs: 1e-9 }, ptol = { rel: 1e-6, abs: 1e-300 };
  return {
    steps,
    implementation: { functions: ["welchT", "varianceFromMoments", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts).",
    python: withResult(python),
    check: {
      "composition:tested": { v: t.cells.filter((c) => c.p != null && (!t.two || c.cohort === t.cohorts[0])).length },
      ...checks("composition:", t.cells as unknown as Record<string, unknown>[], (c) => c.cohort + "|" + c.part, [["mean", "mean", tol], ["log2", "log2", tol], ["p", "p", ptol], ["q", "q", ptol]])
    },
  };
}
