// The mutexpr view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, py, withResult, checks, plural } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { MutexprScale, MutexprResolution, MutexprStratum, MutexprRole } from "./types.ts";

/** one group as drawn: its count, sums and bin counts, summed over the sites (withheld groups are not here) */
export interface MutexprTraceGroup { stratum: string; group: string; role: MutexprRole; n: number; sx: number; sxx: number; bins: number[] }

export interface MutexprTrace {
  cohort: string; gene: string; expressionGene: string; profileType: string;
  scale: MutexprScale; resolution: MutexprResolution; stratify: MutexprStratum[]; fusionGene: string;
  minCount: number; groupCap: number;
  range: [number, number]; bins: number;
  perSite: { study: string; cohortSamples: number; withValue: number; negative: number }[];
  withheldStrata: number; withheldGroups: number;
  groups: MutexprTraceGroup[];
  tested: number;
  /** what the view reported, for the script check */
  results: { stratum: string; group: string; mean: number; median: number; p?: number; q?: number }[];
}

const TESTED_ROLES: MutexprRole[] = ["allMutated", "variant", "multiple", "other"];

export function mutexprMethod(t: MutexprTrace): MethodRecord {
  const [x0, x1] = t.range;
  const scaleText = t.scale === "log2" ? "as log2(v + 1) (a negative stored value has no log and is left out, not clamped)" : t.scale === "zscore" ? "as stored (z-scores)" : "as stored";
  const noun = t.resolution === "codon" ? "codon" : "protein change";
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count the samples with a value, and the range of the values",
    detail: "The mutexpr:range query above: " + t.expressionGene + " on “" + t.profileType + "” " + scaleText + ", one value per sample (the mean of its rows). " +
      "Returns the cohort's samples, those with a value" + (t.scale === "log2" ? ", those left out for a negative value" : "") + ", and the values' 0.5th and 99.5th percentiles." +
      (s.negative ? " " + plural(s.negative, "sample") + " left out for a negative value." : ""),
    scope: t.cohort + " · " + s.study, rowsIn: s.cohortSamples, rowsOut: s.withValue,
  }));
  steps.push({ kind: "transform", title: "Set the bins every site shares",
    detail: "From the lowest 0.5th to the highest 99.5th percentile across the sites, cut into " + t.bins + " equal bins; a value beyond either end is counted in the end bin, so every sample is counted.",
    params: [["from", String(x0)], ["to", String(x1)], ["bins", String(t.bins)], ["bin width", String((x1 - x0) / t.bins)]] });
  for (const s of t.perSite) steps.push({ kind: "fetch", title: "Count and sum the values per stratum, group and bin",
    detail: "The mutexpr:groups query above. A sample's group is its one " + noun + " of " + t.gene + ", “Several” for more than one, “Not mutated” when its panel covers " + t.gene +
      " for mutations and it has no call (whole exome included), “Not profiled” when its panel does not. A mutation is a call on the panel." +
      (t.stratify.length ? " Strata: " + t.stratify.map((x) => x === "cancerType" ? "CANCER_TYPE, case and spacing folded" : "a structural variant of " + t.fusionGene + ", or not, or not profiled for one").join(" × ") + "." : "") +
      " Per (stratum, group, bin): n, Σv and Σv² — no individual value.",
    scope: t.cohort + " · " + s.study, rowsIn: s.withValue });
  if (t.perSite.length > 1) steps.push({ kind: "transform", title: "Add the sites' counts and sums", detail: "Counts, sums and bin counts add exactly; there is no batch correction between studies." });
  steps.push({ kind: "transform", title: "Form the groups drawn, and withhold the small ones",
    detail: "Per stratum: “All mutated” (every " + noun + " and “Several” together), each " + noun + " with at least " + t.minCount + " samples (the " + t.groupCap + " largest; ties by name), " +
      "“Several”, “Other” (every " + noun + " not drawn on its own, pooled), “Not mutated” and “Not profiled”. A group or a whole stratum with fewer than " + t.minCount + " samples is withheld: no statistic of it is reported, and it is not in the table below.",
    params: [["minCount", String(t.minCount)], ["groups drawn", String(t.groups.length)], ["groups withheld", String(t.withheldGroups)], ["strata withheld", String(t.withheldStrata)]] });
  steps.push({ kind: "statistic", title: "Summarise each group",
    detail: "Mean Σv/n and SD √((Σv² − (Σv)²/n)/(n − 1)), exact. The 5th, 25th, 50th, 75th and 95th percentiles from the bin counts: for probability p, the first bin whose running count reaches p·n, the values in it taken as spread evenly across it — within one bin's width of the smallest value with at least that share of the group at or below it (in a small group this can differ from an averaged median)." });
  steps.push({ kind: "statistic", title: "Welch's t-test against “Not mutated”",
    detail: "Each group other than “Not mutated” and “Not profiled” against “Not mutated” in the same stratum, where both are drawn: difference of means, unequal-variance t, Welch–Satterthwaite df, two-sided. A pair with no variance (Var + Var ≤ 1e-9 · (1 + mean² + mean²)) is not tested.",
    params: [["comparisons", String(t.tested)]] });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across the comparisons", detail: "q-values over all " + plural(t.tested, "comparison") + " in the view." });

  const python = [
    "# Recompute the groups' summaries and tests with numpy, scipy and statsmodels from the counts and sums the queries returned.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import ttest_ind_from_stats",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "X0, X1, BINS = " + x0 + ", " + x1 + ", " + t.bins,
    "W = (X1 - X0) / BINS",
    ...pyTable("groups", "Each group drawn: n, Σv, Σv² and its " + t.bins + " bin counts (space-separated), from the mutexpr:groups queries, summed over the sites",
      ["stratum", "group", "role", "n", "sx", "sxx", "bins"], t.groups.map((g) => [g.stratum, g.group, g.role, g.n, g.sx, g.sxx, g.bins.join(" ")]), "mutexpr_groups.csv"),
    "",
    "def bin_quantile(counts, prob):",
    "    target, cum = prob * sum(counts), 0",
    "    for b, c in enumerate(counts):",
    "        if c > 0 and cum + c >= target:",
    "            return X0 + (b + (target - cum) / c) * W",
    "        cum += c",
    "    return X0 + len(counts) * W",
    "",
    "groups[\"bins\"] = groups[\"bins\"].astype(str).map(lambda s: [int(x) for x in s.split()])",
    "groups[\"mean\"] = groups[\"sx\"] / groups[\"n\"]",
    "groups[\"var\"] = ((groups[\"sxx\"] - groups[\"sx\"] ** 2 / groups[\"n\"]) / (groups[\"n\"] - 1)).where(groups[\"n\"] >= 2).clip(lower=0)",
    "for name, p in [(\"p5\", 0.05), (\"q1\", 0.25), (\"median\", 0.5), (\"q3\", 0.75), (\"p95\", 0.95)]:",
    "    groups[name] = groups[\"bins\"].map(lambda c: bin_quantile(c, p))",
    "",
    "tests = []",
    "for stratum, g in groups.groupby(\"stratum\", sort=False):",
    "    ref = g[g[\"role\"] == \"notMutated\"]",
    "    if ref.empty or ref.iloc[0][\"n\"] < 2:",
    "        continue",
    "    r = ref.iloc[0]",
    "    for i, a in g[g[\"role\"].isin(" + py(TESTED_ROLES.join(",")) + ".split(\",\"))].iterrows():",
    "        if a[\"n\"] < 2 or not (a[\"var\"] + r[\"var\"] > 1e-9 * (1 + a[\"mean\"] ** 2 + r[\"mean\"] ** 2)):",
    "            continue",
    "        _, p = ttest_ind_from_stats(a[\"mean\"], np.sqrt(a[\"var\"]), a[\"n\"], r[\"mean\"], np.sqrt(r[\"var\"]), r[\"n\"], equal_var=False)",
    "        tests.append((i, a[\"mean\"] - r[\"mean\"], p))",
    "groups[\"diff\"], groups[\"p\"], groups[\"q\"] = np.nan, np.nan, np.nan",
    "if tests:",
    "    qs = multipletests([p for _, _, p in tests], method=\"fdr_bh\")[1]",
    "    for (i, d, p), q in zip(tests, qs):",
    "        groups.loc[i, [\"diff\", \"p\", \"q\"]] = d, p, q",
    "print(groups[[\"stratum\", \"group\", \"n\", \"mean\", \"median\", \"q1\", \"q3\", \"diff\", \"p\", \"q\"]].to_string(index=False))",
    "RESULT[\"mutexpr:tested\"] = len(tests)",
    "for r in groups.itertuples():",
    "    RESULT[f\"mutexpr:{r.stratum}:{r.group}:mean\"], RESULT[f\"mutexpr:{r.stratum}:{r.group}:median\"] = r.mean, r.median",
    "    if not np.isnan(r.p):",
    "        RESULT[f\"mutexpr:{r.stratum}:{r.group}:p\"], RESULT[f\"mutexpr:{r.stratum}:{r.group}:q\"] = r.p, r.q",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["runMutexpr", "binQuantile", "welchT", "benjaminiHochberg"], file: "lib/views/mutexpr/run.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts); binQuantile is held to numpy's percentiles of the binned values in test/mutexpr.test.ts.",
    python: withResult(python),
    check: {
      "mutexpr:tested": { v: t.tested, abs: 0 },
      ...checks("mutexpr:", t.results, (r) => r.stratum + ":" + r.group, [["mean", "mean", { rel: 1e-9 }], ["median", "median", { rel: 1e-9, abs: 1e-9 }],
        ["p", "p", { rel: 1e-6, abs: 1e-300 }], ["q", "q", { rel: 1e-6, abs: 1e-300 }]]),
    },
  };
}
