// The incidence view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, pFmt, pyTable, RESULT_INIT, VERIFIED, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

/** python/golden/gray_null.py verbatim — the Python port of our seeded Gray permutation test;
 *  test/incidence-golden.test.ts holds the two to the same text and the port to our exact p. */
export const GRAY_NULL_PY = "import math\n\n\ndef mulberry32(seed):\n    a = seed & 0xFFFFFFFF\n\n    def rnd():\n        nonlocal a\n        a = (a + 0x6D2B79F5) & 0xFFFFFFFF\n        t = a\n        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF\n        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF\n        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296\n\n    return rnd\n\n\ndef gray_statistic(t, cause, entry, group, K, order, entry_order):\n    \"\"\"Sum over groups of (observed - expected)^2 / expected cause-1 events, expected from the pooled\n    subdistribution hazard with each group's risk set Y_k (1 - F1_k) / S_k (Gray 1988, weight 1).\n    order / entry_order: the records' indices sorted by exit and by entry time.\"\"\"\n    n = len(t)\n    Y, S, F = [0.0] * K, [1.0] * K, [0.0] * K\n    z, E = [0.0] * K, [0.0] * K\n    i = ei = 0\n    while i < n:\n        tj = t[order[i]]\n        while ei < n and entry[entry_order[ei]] < tj:\n            Y[group[entry_order[ei]]] += 1\n            ei += 1\n        d1, d2, cc = [0.0] * K, [0.0] * K, [0.0] * K\n        while i < n and t[order[i]] == tj:\n            r = order[i]\n            i += 1\n            if cause[r] == 1:\n                d1[group[r]] += 1\n            elif cause[r] == 2:\n                d2[group[r]] += 1\n            else:\n                cc[group[r]] += 1\n        R = [Y[k] * (1 - F[k]) / S[k] if Y[k] > 0 and S[k] > 0 else 0.0 for k in range(K)]\n        D1, Rtot = 0.0, 0.0\n        for k in range(K):\n            D1 += d1[k]\n            Rtot += R[k]\n        if D1 > 0 and Rtot > 0:\n            for k in range(K):\n                e = R[k] * D1 / Rtot\n                z[k] += d1[k] - e\n                E[k] += e\n        for k in range(K):\n            if Y[k] > 0:\n                F[k] += S[k] * d1[k] / Y[k]\n                S[k] *= 1 - (d1[k] + d2[k]) / Y[k]\n            Y[k] -= d1[k] + d2[k] + cc[k]\n    stat = 0.0\n    for k in range(K):\n        if E[k] > 0:\n            stat += z[k] * z[k] / E[k]\n    return stat\n\n\ndef gray_permutation_test(groups, permutations=2000, seed=1):\n    \"\"\"groups: per cohort, a list of (t, cause, entry or None). Returns (statistic, p): p = (b + 1)/(m + 1)\n    over `permutations` seeded shuffles of the cohort labels across the pooled records.\"\"\"\n    K = len(groups)\n    rows = [(r[0], r[1], -math.inf if r[2] is None else r[2], k) for k, g in enumerate(groups) for r in g]\n    t = [r[0] for r in rows]\n    cause = [r[1] for r in rows]\n    entry = [r[2] for r in rows]\n    labels = [r[3] for r in rows]\n    order = sorted(range(len(t)), key=lambda i: t[i])\n    entry_order = sorted(range(len(t)), key=lambda i: entry[i])\n    observed = gray_statistic(t, cause, entry, labels, K, order, entry_order)\n    rnd = mulberry32(seed)\n    perm = list(labels)\n    n = len(perm)\n    beyond = 0\n    for _ in range(permutations):\n        for i in range(n - 1, 0, -1):\n            j = math.floor(rnd() * (i + 1))\n            perm[i], perm[j] = perm[j], perm[i]\n        if gray_statistic(t, cause, entry, perm, K, order, entry_order) >= observed - 1e-12:\n            beyond += 1\n    return observed, (beyond + 1) / (permutations + 1)\n";

export interface IncidenceTrace {
  eventLabel: string;
  anchor?: string;
  horizons: number[];
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  cohorts: { name: string; n: number; events: number; competing: number; censored: number; late: number;
    excluded: { prior: number; unobserved: number; noFollowup: number; noAnchor: number } }[];
  /** every (entry, t, cause) count the queries returned for patients who enter the risk set */
  counts: { cohort: string; study: string; entry: number; t: number; cause: number; n: number }[];
  gray?: { statistic: number; p: number; permutations: number };
  /** the view's estimate and interval at each horizon — for the script check */
  horizonResults: { cohort: string; months: number; f1: number; lo: number; hi: number }[];
}

export function incidenceMethod(t: IncidenceTrace): MethodRecord {
  const hasEntry = t.counts.some((r) => r.entry > 0);
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Classify and count each patient's outcome",
    detail: "The incidence query above. Per patient, months from " + (t.anchor ? "the " + t.anchor : "the study's day 0") +
      " (days ÷ 30.4375, rounded to 4 decimals) to the first " + t.eventLabel + " after it (cause 1), death without it (cause 2, from OS_STATUS), or last follow-up (censored, OS_MONTHS)" +
      (t.anchor ? ", and the delay from the anchor to day 0 as a delayed entry when the anchor comes first" : "") +
      "; then counted by (entry, months, cause). Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: "Set aside patients who cannot enter the risk set",
    detail: "Named and counted rather than treated as event-free. A patient whose first event was recorded after their last follow-up is kept, as censored or dead at follow-up.",
    params: t.cohorts.map((c) => [c.name, c.excluded.prior + " already had it " + (t.anchor ? "at or before the anchor" : "by day 0") +
      (c.excluded.unobserved ? " · " + c.excluded.unobserved + " had it before observation began" : "") +
      " · " + c.excluded.noFollowup + " without follow-up" + (t.anchor ? " · " + c.excluded.noAnchor + " with no anchor event" : "") +
      (c.late ? " · " + c.late + " recorded late, kept" : "")] as [string, string]) });
  steps.push({ kind: "statistic", title: "Estimate cumulative incidence by Aalen–Johansen",
    detail: "Death is a competing risk: at each time F1 rises by S(t−)·d1/R, with S the all-cause Kaplan–Meier survival and R those at risk" +
      (hasEntry ? " (entered strictly before t: delayed entry honoured)" : "") +
      ". Standard error by the delta method (Aalen 1978); 95% interval F1 ± 1.959964·SE, clamped to [0, 1]. At each horizon the curve's value there, beside 1 − Kaplan–Meier of the event alone, which counts the dead as still at risk and overstates incidence.",
    params: [["horizons (months)", t.horizons.join(", ")],
      ...t.cohorts.map((c) => [c.name, c.n.toLocaleString() + " at risk · " + c.events + " events · " + c.competing + " deaths first · " + c.censored + " censored"] as [string, string])] });
  if (t.gray) steps.push({ kind: "statistic", title: "Gray-type test by permutation",
    detail: "Per cohort, observed cause-1 events minus those expected from the pooled subdistribution hazard, the subdistribution risk set being Y·(1 − F1)/S (Gray 1988, weight 1), summed as Σ (O − E)²/E over cohorts. This is not Gray's variance-standardised χ², so its p does not come from a χ² table: the cohort labels are shuffled across the pooled records " +
      t.gray.permutations.toLocaleString() + " times by a generator seeded with 1, and p = (b + 1)/(m + 1). Exact under the null that every cohort's records, entry times included, come from one distribution.",
    params: [["statistic / p", t.gray.statistic.toFixed(4) + " / " + pFmt(t.gray.p)]] });
  const python = [
    "# Recompute: cumulative incidence with statsmodels" + (hasEntry ? " (or, with delayed entry, the short function below — statsmodels takes no entry times and lifelines jitters tied ones)" : "") +
      "; the Gray-type test with the port of our seeded permutation test below, which reproduces our p exactly (test/incidence-golden.test.ts).",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    ...(hasEntry ? [] : ["from statsmodels.duration.survfunc import CumIncidenceRight"]),
    "",
    ...pyTable("counts", "What the incidence queries returned for the patients who enter the risk set: n per (entry, months, cause); cause 1 the event, 2 death first, 0 censored",
      ["cohort", "study", "entry", "t", "cause", "n"], t.counts.map((r) => [r.cohort, r.study, r.entry, r.t, r.cause, r.n]), "incidence_counts.csv"),
    "df = counts.loc[counts.index.repeat(counts[\"n\"])].reset_index(drop=True)  # one row per patient",
    "horizons = " + JSON.stringify(t.horizons),
    RESULT_INIT,
    "",
    ...(hasEntry ? [
      "def aalen_johansen(t, cause, entry):",
      "    \"\"\"F1, F2 and the delta-method SE of F1 at each time anyone leaves; at risk = entered strictly before t, not yet left.\"\"\"",
      "    t, cause, entry = map(np.asarray, (t, cause, entry))",
      "    times = np.unique(t)",
      "    S, F1, F2, hist, out = 1.0, 0.0, 0.0, [], []",
      "    for x in times:",
      "        R = np.sum((entry < x) & (t >= x))",
      "        d1, d2 = np.sum((t == x) & (cause == 1)), np.sum((t == x) & (cause == 2))",
      "        if R <= 0:",
      "            continue",
      "        Sprev, d = S, d1 + d2",
      "        F1 += Sprev * d1 / R; F2 += Sprev * d2 / R; S *= 1 - d / R",
      "        hist.append((F1, Sprev, d, d1, R))",
      "        if d > 0:",
      "            v = sum(((F1 - hF1) ** 2 * hd / (hR * (hR - hd)) if hR - hd > 0 else 0) + hS ** 2 * hd1 * (hR - hd1) / hR ** 3 - 2 * (F1 - hF1) * hS * hd1 / hR ** 2",
      "                    for hF1, hS, hd, hd1, hR in hist if hd > 0)",
      "            out.append((x, F1, F2, np.sqrt(max(v, 0))))",
      "    return pd.DataFrame(out, columns=[\"t\", \"f1\", \"f2\", \"se1\"])",
      "",
    ] : []),
    "for cohort, g in df.groupby(\"cohort\", sort=False):",
    ...(hasEntry ? [
      "    cif = aalen_johansen(g[\"t\"], g[\"cause\"], np.where(g[\"entry\"] > 0, g[\"entry\"], -np.inf))",
    ] : [
      "    c = CumIncidenceRight(g[\"t\"].to_numpy(), g[\"cause\"].to_numpy())",
      "    cif = pd.DataFrame({\"t\": c.times, \"f1\": c.cinc[0], \"se1\": c.cinc_se[0]})",
    ]),
    "    for h in horizons:",
    "        at = cif[cif[\"t\"] <= h].tail(1)",
    "        f1, se = (float(at[\"f1\"].iloc[0]), float(at[\"se1\"].iloc[0])) if len(at) else (0.0, 0.0)",
    "        lo, hi = max(0, f1 - 1.959963984540054 * se), min(1, f1 + 1.959963984540054 * se)  # 95%: the exact normal quantile",
    "        print(f\"{cohort} at {h} months: {f1:.4f} (95% CI {lo:.4f}-{hi:.4f})\")",
    "        RESULT[f\"incidence:{cohort}:{h}:f1\"], RESULT[f\"incidence:{cohort}:{h}:lo\"], RESULT[f\"incidence:{cohort}:{h}:hi\"] = f1, lo, hi",
    ...(t.gray ? [
      "",
      "# ---- the port of our seeded Gray-type permutation test (python/golden/gray_null.py) ----",
      ...GRAY_NULL_PY.trimEnd().split("\n"),
      "# ----",
      "",
      "cohorts = " + JSON.stringify(t.cohorts.map((c) => c.name)),
      "# records in the order the test sees them: by time, then cause, then entry (none before any)",
      "groups = [[(r.t, r.cause, r.entry if r.entry > 0 else None)",
      "           for r in df[df[\"cohort\"] == c].sort_values([\"t\", \"cause\", \"entry\"], kind=\"stable\").itertuples()] for c in cohorts]",
      "stat, p = gray_permutation_test(groups, permutations=" + t.gray.permutations + ", seed=1)  # pure Python: minutes for a large cohort",
      "print(f\"Gray-type statistic {stat:.4f}, permutation p {p:.4g}\")",
      "RESULT[\"gray:statistic\"], RESULT[\"gray:p\"] = stat, p",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["aalenJohansen", "cifAt", "kaplanMeier", ...(t.gray ? ["grayPermutationTest"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Cumulative incidence and its standard error match statsmodels " + VERIFIED.cif.version + " CumIncidenceRight to 1e-12, and with delayed entry lifelines' AalenJohansenFitter" +
      (t.gray ? "; the Gray-type statistic and permutation p match the script's port exactly" : "") + " (test/incidence-golden.test.ts).",
    python: withResult(python),
    check: {
      ...checks("incidence:", t.horizonResults, (h) => h.cohort + ":" + h.months, [["f1", "f1", { abs: 1e-9 }], ["lo", "lo", { abs: 1e-9 }], ["hi", "hi", { abs: 1e-9 }]]),
      // the port reproduces the permutation test exactly
      ...(t.gray ? { "gray:statistic": { v: t.gray.statistic, rel: 1e-12 }, "gray:p": { v: t.gray.p, abs: 0 } } : {}),
    },
  };
}
