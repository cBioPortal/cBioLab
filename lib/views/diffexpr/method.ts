// The diffexpr view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, py, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

/** python/golden/gsea_null.py verbatim — the Python port of our seeded GSEA null; test/gsea-golden.test.ts
 *  holds the two to the same text and proves the port gives our p-values exactly. */
export const GSEA_NULL_PY = "import math\n\n\ndef seed_of(s):\n    \"\"\"FNV-1a over the name's UTF-16 code units: the seed each set's null is drawn from.\"\"\"\n    h = 0x811C9DC5\n    for unit in memoryview(s.encode(\"utf-16-le\")).cast(\"H\"):\n        h = ((h ^ unit) * 0x01000193) & 0xFFFFFFFF\n    return h\n\n\ndef mulberry32(seed):\n    a = seed & 0xFFFFFFFF\n\n    def rnd():\n        nonlocal a\n        a = (a + 0x6D2B79F5) & 0xFFFFFFFF\n        t = a\n        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF\n        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF\n        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296\n\n    return rnd\n\n\ndef enrichment_score(positions, weights, n):\n    \"\"\"Weighted (p = 1) running-sum ES from the members' 0-based ranks, ascending.\"\"\"\n    k = len(positions)\n    if not k or k >= n:\n        return 0.0\n    nr = sum(weights)\n    unweighted = not nr > 0\n    if unweighted:\n        nr = k\n    miss = 1 / (n - k)\n    cum, best = 0.0, 0.0\n    for i, (pos, w) in enumerate(zip(positions, weights)):\n        before = cum / nr - (pos - i) * miss\n        if abs(before) > abs(best):\n            best = before\n        cum += 1 if unweighted else w\n        after = cum / nr - (pos + 1 - (i + 1)) * miss\n        if abs(after) > abs(best):\n            best = after\n    return best\n\n\ndef preranked_gsea(ranked, sets, permutations=1000, min_size=10):\n    \"\"\"ranked: [(gene, score)] best first; sets: {name: [genes]}. Returns {name: (size, es, nes, p)}.\n    The null for each set is `permutations` random sets of the same size drawn from the same ranking\n    (Floyd's sampling), from a generator seeded by the set's name, so p is the same on every run.\"\"\"\n    n = len(ranked)\n    rank_of = {}\n    for i, (g, _) in enumerate(ranked):\n        rank_of.setdefault(g, i)\n    abs_w = [abs(s) for _, s in ranked]\n    out = {}\n    for name, genes in sets.items():\n        pos = sorted({rank_of[g] for g in set(genes) if g in rank_of})\n        k = len(pos)\n        if k < min_size or k >= n:\n            continue\n        es = enrichment_score(pos, [abs_w[i] for i in pos], n)\n        rnd = mulberry32(seed_of(name))\n        null_pos, null_neg = [], []\n        for _ in range(permutations):\n            chosen = set()\n            for j in range(n - k, n):\n                t = math.floor(rnd() * (j + 1))\n                chosen.add(j if t in chosen else t)\n            pick = sorted(chosen)\n            e = enrichment_score(pick, [abs_w[i] for i in pick], n)\n            (null_pos if e >= 0 else null_neg).append(e)\n        mean = lambda xs: sum(xs) / len(xs) if xs else 0.0\n        if es >= 0:\n            nes = es / mean(null_pos) if mean(null_pos) > 0 else 0.0\n            same, beyond = null_pos, sum(1 for e in null_pos if e >= es)\n        else:\n            nes = -es / mean(null_neg) if mean(null_neg) < 0 else 0.0\n            same, beyond = null_neg, sum(1 for e in null_neg if e <= es)\n        out[name] = (k, es, nes, (beyond + 1) / (len(same) + 1))\n    return out\n";

export interface DiffexprTrace {
  profileType: string;
  log2: boolean;
  groups: [string, string];
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** per cohort, summed over its studies: each gene's n, Σv and Σv² */
  moments: { cohort: string; gene: string; n: number; sx: number; sxx: number }[];
  minN: number;
  tested: number;
  skipped: number;
  gsea?: { sets: { name: string; genes: string[] }[]; tested: number; skipped: string[]; permutations: number; minSize: number };
  /** what the view reported — genes drawn as points, and each set tested — for the script check */
  results: { genes: { gene: string; p: number; q: number }[]; sets: { name: string; es: number; nes: number; p: number }[] };
}

export function diffexprMethod(t: DiffexprTrace): MethodRecord {
  const [A, B] = t.groups;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum every gene's values",
    detail: "The diffexpr:moments query above, on “" + t.profileType + "”" + (t.log2 ? " as log2(v + 1) (a negative stored value has no log and is left out, not clamped)" : " as stored") +
      ". Per gene, over the cohort's patients with a value (a patient with several samples contributes their average): n, Σv and Σv². Every gene in the profile, no individual value.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's sums across its studies",
    detail: "The totals add exactly; there is no batch correction between studies." });
  steps.push({ kind: "transform", title: "Leave out genes that cannot be tested",
    detail: "A gene with fewer than " + t.minN + " patients with a value in either cohort, or with no variance (Var A + Var B ≤ 1e-9 · (1 + mean A² + mean B²) — judged to a tolerance, since a constant gene's variance from the sums is rounding noise).",
    rowsIn: t.tested + t.skipped, rowsOut: t.tested });
  steps.push({ kind: "statistic", title: "Welch's t-test per gene",
    detail: "Mean A − mean B (" + A + " minus " + B + ") with each cohort's variance (Σv² − (Σv)²/n)/(n − 1); unequal-variance t, Welch–Satterthwaite df, two-sided. With thousands of patients a tiny difference is significant: read the effect too.",
    params: [["genes tested", t.tested.toLocaleString()]] });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes", detail: "q-values over all " + t.tested.toLocaleString() + " genes tested." });
  if (t.gsea) steps.push({ kind: "statistic", title: "Preranked gene-set enrichment (GSEA)",
    detail: "Genes ranked by the unrounded t, " + A + " over " + B + " first. Enrichment score as in Subramanian et al. 2005 with weight 1 (each member's step is |t| / Σ|t| of the members). Significance from " +
      t.gsea.permutations + " random sets of the same size drawn from the same ranking, from a generator seeded by the set's name — so a shared link gives the same p — with p = (b + 1)/(m + 1) over the m null scores of the same sign and NES = ES / mean of those. Gene-set permutation ignores correlation between genes, so it is anti-conservative next to phenotype permutation. A set with fewer than " +
      t.gsea.minSize + " ranked members is not tested. q is Benjamini–Hochberg across the sets tested.",
    params: [["sets tested", String(t.gsea.tested)], ...(t.gsea.skipped.length ? [["too small to test", t.gsea.skipped.join(", ")] as [string, string]] : [])] });
  const python = [
    "# Recompute with scipy and statsmodels; the enrichment uses the port of our seeded null below,",
    "# which reproduces our permutation p-values exactly (test/gsea-golden.test.ts). Its enrichment scores match gseapy " + VERIFIED.gsea.version + " prerank.",
    "import io",
    "import json",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import ttest_ind_from_stats",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("moments", "Each gene's n, sum and sum of squares per cohort (" + (t.log2 ? "log2(v + 1)" : "as stored") + "), from the diffexpr:moments queries, summed over each cohort's studies",
      ["cohort", "gene", "n", "sx", "sxx"], t.moments.map((r) => [r.cohort, r.gene, r.n, r.sx, r.sxx]), "diffexpr_moments.csv"),
    "",
    "a = moments[moments[\"cohort\"] == " + py(A) + "].set_index(\"gene\")",
    "b = moments[moments[\"cohort\"] == " + py(B) + "].set_index(\"gene\")",
    "g = a.join(b, lsuffix=\"_a\", rsuffix=\"_b\", how=\"inner\")",
    "g[\"mean_a\"], g[\"mean_b\"] = g[\"sx_a\"] / g[\"n_a\"], g[\"sx_b\"] / g[\"n_b\"]",
    "g[\"var_a\"] = ((g[\"sxx_a\"] - g[\"sx_a\"] ** 2 / g[\"n_a\"]) / (g[\"n_a\"] - 1)).clip(lower=0)  # a constant gene's is rounding noise, sometimes below 0",
    "g[\"var_b\"] = ((g[\"sxx_b\"] - g[\"sx_b\"] ** 2 / g[\"n_b\"]) / (g[\"n_b\"] - 1)).clip(lower=0)",
    "keep = (g[\"n_a\"] >= " + t.minN + ") & (g[\"n_b\"] >= " + t.minN + ") & (g[\"var_a\"] + g[\"var_b\"] > 1e-9 * (1 + g[\"mean_a\"] ** 2 + g[\"mean_b\"] ** 2))",
    "g = g[keep].copy()",
    "g[\"t\"], g[\"p\"] = ttest_ind_from_stats(g[\"mean_a\"], np.sqrt(g[\"var_a\"]), g[\"n_a\"], g[\"mean_b\"], np.sqrt(g[\"var_b\"]), g[\"n_b\"], equal_var=False)",
    "g[\"effect\"] = g[\"mean_a\"] - g[\"mean_b\"]",
    "g[\"q\"] = multipletests(g[\"p\"], method=\"fdr_bh\")[1]",
    "print(len(g), \"genes tested\")",
    "print(g.sort_values(\"p\")[[\"effect\", \"t\", \"p\", \"q\"]].head(20))",
    "RESULT[\"diffexpr:tested\"] = len(g)",
    "for gene, r in g.iterrows():",
    "    RESULT[f\"diffexpr:{gene}:p\"], RESULT[f\"diffexpr:{gene}:q\"] = r[\"p\"], r[\"q\"]",
    ...(t.gsea ? [
      "",
      "# ---- the port of our seeded GSEA null (python/golden/gsea_null.py) ----",
      ...GSEA_NULL_PY.trimEnd().split("\n"),
      "# ----",
      "",
      "sets = json.loads(" + py(JSON.stringify(Object.fromEntries(t.gsea.sets.map((x) => [x.name, x.genes])))) + ")",
      "ranked = list(g.sort_values(\"t\", ascending=False, kind=\"stable\")[\"t\"].items())",
      "res = preranked_gsea(ranked, sets, permutations=" + t.gsea.permutations + ", min_size=" + t.gsea.minSize + ")",
      "out = pd.DataFrame([(k, *v) for k, v in res.items()], columns=[\"set\", \"size\", \"es\", \"nes\", \"p\"])",
      "out[\"q\"] = multipletests(out[\"p\"], method=\"fdr_bh\")[1]",
      "print(out.sort_values([\"q\", \"nes\"], key=lambda c: c if c.name == \"q\" else -c.abs()).to_string(index=False))",
      "for r in out.itertuples():",
      "    RESULT[f\"gsea:{r.set}:es\"], RESULT[f\"gsea:{r.set}:nes\"], RESULT[f\"gsea:{r.set}:p\"] = r.es, r.nes, r.p",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["welchT", "benjaminiHochberg", ...(t.gsea ? ["preRankedGsea"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts)" +
      (t.gsea ? "; enrichment scores match gseapy " + VERIFIED.gsea.version + " prerank, and NES and p match the script's port of our seeded null exactly (test/gsea-golden.test.ts)" : "") + ".",
    python: withResult(python),
    check: {
      "diffexpr:tested": { v: t.tested, abs: 0 },
      ...checks("diffexpr:", t.results.genes, (g) => g.gene, [["p", "p", { rel: 1e-6, abs: 1e-300 }], ["q", "q", { rel: 1e-6, abs: 1e-300 }]]),
      // ES and NES are reported to 4 and 3 decimals; the permutation p is a ratio of counts
      ...checks("gsea:", t.results.sets, (x) => x.name, [["es", "es", { abs: 5e-5 + 1e-12 }], ["nes", "nes", { abs: 5e-4 + 1e-12 }], ["p", "p", { abs: 0 }]]),
    },
  };
}
