// The correlates view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, py, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CorrelatesTrace {
  gene: string; profileType: string; otherProfile: string; cohort: string;
  minN: number; multi: boolean; tested: number; untested: number;
  perSite: { study: string; genes: number; samples: number }[];
  /** per study and gene: the six sums on values, and the same six on average ranks */
  sums: { study: string; gene: string; n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number;
    rsx: number; rsy: number; rsxy: number; rsxx: number; rsyy: number }[];
  /** what the view reported, for the script check */
  results: { gene: string; rho: number; rhoP: number; q: number; r: number; p: number }[];
}

export function correlatesMethod(t: CorrelatesTrace): MethodRecord {
  const same = t.profileType === t.otherProfile;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum every gene's values and ranks against " + t.gene + "'s",
    detail: "The correlates:moments query above. Per sample in the cohort, " + t.gene + " on “" + t.profileType + "” and every gene on “" + t.otherProfile +
      "” (a patient-level assay's value paired with each of its patient's samples); per gene, over the samples with both: n, Σx, Σy, Σxy, Σx², Σy², and the same six over each value's average rank among those samples (ties share the mean of their ranks). Sums only.",
    scope: t.cohort + " · " + s.study, rowsIn: s.samples, rowsOut: s.genes,
  }));
  steps.push({ kind: "statistic", title: "Pearson's r and Spearman's ρ per gene",
    detail: "r from the sums: (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)); ρ is the same formula on the rank sums. Each p from t = r√((n − 2)/(1 − r²)) on n − 2 df, as scipy's pearsonr and spearmanr compute it." +
      (t.multi ? " Across studies, r pools the sums (exact); ρ is each study's, combined by Fisher z with weight n − 3 and a normal p, because ranks do not add." : "") +
      (same ? " " + t.gene + " against itself is left out." : "") + " A gene with fewer than " + t.minN + " samples, or no spread, is not tested.",
    params: [["tested", t.tested.toLocaleString("en-US")], ["not tested", t.untested.toLocaleString("en-US")]] });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg over ρ", detail: "q-values over every gene tested, from ρ's p." });
  const python = [
    "# Recompute with numpy, scipy " + VERIFIED.pearson.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import t as student_t, norm",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "MIN_N = " + t.minN,
    "QUERY = " + py(t.gene) + (same ? "  # left out: a gene against itself" : ""),
    ...pyTable("sums", "Per study and gene: the six sums on values and on average ranks, from the correlates:moments queries",
      ["study", "gene", "n", "sx", "sy", "sxy", "sxx", "syy", "rsx", "rsy", "rsxy", "rsxx", "rsyy"],
      t.sums.map((r) => [r.study, r.gene, r.n, r.sx, r.sy, r.sxy, r.sxx, r.syy, r.rsx, r.rsy, r.rsxy, r.rsxx, r.rsyy]), "correlates_sums.csv"),
    "",
    "def corr(n, sx, sy, sxy, sxx, syy):",
    "    den = np.sqrt((n * sxx - sx ** 2) * (n * syy - sy ** 2))",
    "    with np.errstate(invalid=\"ignore\", divide=\"ignore\"):",
    "        return np.where(den > 0, (n * sxy - sx * sy) / den, np.nan).clip(-1, 1)",
    "",
    "def t_p(r, n):",
    "    with np.errstate(invalid=\"ignore\", divide=\"ignore\"):",
    "        tt = r * np.sqrt((n - 2) / (1 - r ** 2))",
    "    return np.where(np.abs(r) >= 1, 0.0, 2 * student_t.sf(np.abs(tt), n - 2))",
    "",
    "sums[\"rho_s\"] = corr(sums.n, sums.rsx, sums.rsy, sums.rsxy, sums.rsxx, sums.rsyy)",
    "g = sums.groupby(\"gene\")[[\"n\", \"sx\", \"sy\", \"sxy\", \"sxx\", \"syy\"]].sum()",
    "g[\"r\"] = corr(g.n, g.sx, g.sy, g.sxy, g.sxx, g.syy)",
    "g[\"p\"] = t_p(g.r, g.n)",
    ...(t.multi ? [
      "# rho: each study's own, combined by Fisher z with weight n - 3 (|rho| = 1 or n < 4 carries no z)",
      "ok = (sums.n >= 4) & (sums.rho_s.abs() < 1) & sums.rho_s.notna()",
      "s = sums[ok].assign(w=lambda d: d.n - 3, z=lambda d: np.arctanh(d.rho_s))",
      "m = s.assign(wz=s.w * s.z).groupby(\"gene\")[[\"w\", \"wz\"]].sum()",
      "z = m.wz / m.w",
      "g[\"rho\"] = np.tanh(z).reindex(g.index)",
      "g[\"rho_p\"] = pd.Series(2 * norm.sf(np.abs(z) * np.sqrt(m.w)), index=m.index).reindex(g.index)",
    ] : [
      "g[\"rho\"] = sums.set_index(\"gene\").rho_s.reindex(g.index)",
      "g[\"rho_p\"] = t_p(g.rho, g.n)",
    ]),
    "g = g[(g.n >= MIN_N) & g.rho.notna() & g.r.notna()" + (same ? " & (g.index != QUERY)" : "") + "].copy()",
    "g[\"q\"] = multipletests(g.rho_p, method=\"fdr_bh\")[1]",
    "print(len(g), \"genes tested\")",
    "print(g.sort_values(\"rho\", ascending=False)[[\"n\", \"rho\", \"rho_p\", \"q\", \"r\", \"p\"]].head(15))",
    "print(g.sort_values(\"rho\")[[\"n\", \"rho\", \"rho_p\", \"q\", \"r\", \"p\"]].head(15))",
    "RESULT[\"correlates:tested\"] = len(g)",
    "for gene, x in g.iterrows():",
    "    for f in (\"rho\", \"rho_p\", \"q\", \"r\", \"p\"):",
    "        RESULT[f\"correlates:{gene}:{f}\"] = x[f]",
  ].join("\n") + "\n";
  // ρ and r are reported to 4 decimals; their p-values come from the unrounded coefficient
  const pTol = { rel: 1e-6, abs: 1e-300 };
  return {
    steps,
    implementation: { functions: ["pearsonFromMoments", ...(t.multi ? ["fisherZMeta"] : []), "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Pearson's r from sums matches scipy " + VERIFIED.pearson.version + " pearsonr (test/moments-golden.test.ts); ρ is the same formula on average ranks, which is how scipy's spearmanr defines it — checked against spearmanr on raw values for TCGA breast cancer ESR1 (FOXA1 ρ 0.7478, PSAT1 −0.6732). Benjamini–Hochberg matches statsmodels multipletests (test/tables-golden.test.ts).",
    python: withResult(python),
    check: { "correlates:tested": { v: t.tested },
      ...checks("correlates:", t.results.slice(0, 80), (r) => r.gene, [["rho", "rho", { abs: 5e-5 + 1e-12 }], ["rhoP", "rho_p", pTol], ["q", "q", pTol], ["r", "r", { abs: 5e-5 + 1e-12 }], ["p", "p", pTol]]) },
  };
}
