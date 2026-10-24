// The coexpression view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CoexpressionTrace {
  cohort: string;
  profileType: string;
  cohortPatients: { study: string; patients: number }[];
  sums: { study: string; a: string; b: string; n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number }[];
  pairs: number;
  tested: number;
  /** what the view reported per pair — for the script check */
  results: { a: string; b: string; r: number | null; p: number; q: number; pMeta?: number }[];
}

export function coexpressionMethod(t: CoexpressionTrace): MethodRecord {
  const multi = t.cohortPatients.length > 1;
  const steps: MethodStep[] = t.cohortPatients.map((s) => ({
    kind: "fetch" as const, title: "Sum each gene pair's values",
    detail: "The pairMoments query above, on “" + t.profileType + "”. Per pair, over the patients with a value for both genes (a patient with several samples contributes their average): n, Σx, Σy, Σxy, Σx² and Σy² — six sums, no individual value.",
    scope: t.cohort + " · " + s.study, rowsIn: s.patients, params: [["pairs", String(t.pairs)]],
  }));
  if (multi) steps.push({ kind: "transform", title: "Add the six sums across studies",
    detail: "Every one is a sum, so the pooled totals — and the correlation of all patients taken together — are exact." });
  steps.push({ kind: "statistic", title: "Pearson correlation per pair" + (multi ? ", pooled" : ""),
    detail: "r = (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)); t = r√((n − 2)/(1 − r²)), two-sided p on n − 2 df. Undefined for n < 3 or a constant series." });
  if (multi) steps.push({ kind: "statistic", title: "Fisher-z meta-analysis across studies",
    detail: "Each study's own r → z = atanh(r), weighted by n − 3 (fixed effect); a study with n < 4 or |r| = 1 is left out. Pooled z / SE against the normal, two-sided. This asks whether the genes move together within a study, which differing study means can hide in the pooled r; it is the p that is corrected and ranked." });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across pairs",
    detail: "q-values over the " + t.tested + " pairs with a defined correlation, from the " + (multi ? "meta-analysis" : "Pearson") + " p-values." });
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.pearson.version + " and statsmodels " + VERIFIED.meta.version +
      " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import t as t_dist",
    ...(multi ? ["from statsmodels.stats.meta_analysis import combine_effects"] : []),
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("sums", "What the pairMoments query returned for each study, cohort " + JSON.stringify(t.cohort) + ", profile " + t.profileType,
      ["study", "a", "b", "n", "sx", "sy", "sxy", "sxx", "syy"], t.sums.map((r) => [r.study, r.a, r.b, r.n, r.sx, r.sy, r.sxy, r.sxx, r.syy]), "pair_sums.csv"),
    "",
    "def pearson(s):",
    "    # the same r and p scipy.stats.pearsonr gives on the values these sums came from",
    "    vx, vy = s.n * s.sxx - s.sx ** 2, s.n * s.syy - s.sy ** 2",
    "    if s.n < 3 or vx <= 0 or vy <= 0:",
    "        return None, 1.0",
    "    r = float(np.clip((s.n * s.sxy - s.sx * s.sy) / np.sqrt(vx * vy), -1, 1))",
    "    if abs(r) == 1:",
    "        return r, 0.0",
    "    t = r * np.sqrt((s.n - 2) / (1 - r * r))",
    "    return r, 2 * t_dist.sf(abs(t), s.n - 2)",
    "",
    "rows = []",
    "for (a, b), g in sums.groupby([\"a\", \"b\"], sort=False):",
    "    r, p = pearson(g[[\"n\", \"sx\", \"sy\", \"sxy\", \"sxx\", \"syy\"]].sum())",
    "    row = {\"a\": a, \"b\": b, \"r\": r, \"p\": p}",
    ...(multi ? [
      "    if len(g) > 1:  # in more than one study: meta-analyse the per-study correlations",
      "        per = [(pearson(s)[0], s.n) for s in g.itertuples()]",
      "        per = [(r_, n) for r_, n in per if r_ is not None and n >= 4 and abs(r_) < 1]",
      "        if per:",
      "            z = np.arctanh([r_ for r_, _ in per]); var = np.array([1 / (n - 3) for _, n in per])",
      "            res = combine_effects(z, var, method_re=\"chi2\")",
      "            zf, se = res.mean_effect_fe, res.sd_eff_w_fe",
      "            row.update(r_meta=np.tanh(zf), p_meta=2 * t_dist.sf(abs(zf / se), np.inf))  # normal tail",
      "        else:",
      "            row.update(r_meta=None, p_meta=1.0)  # no study had a usable correlation",
    ] : []),
    "    rows.append(row)",
    "",
    "result = pd.DataFrame(rows)",
    "tested = result[result[\"r\"].notna()]",
    "p = " + (multi ? "tested[\"p_meta\"].fillna(tested[\"p\"])" : "tested[\"p\"]"),
    "result.loc[tested.index, \"q\"] = multipletests(p, method=\"fdr_bh\")[1]",
    "print(result.reindex(result[\"r\"].abs().sort_values(ascending=False).index).to_string(index=False))",
    "for r in result.itertuples():",
    "    for f in (\"r\", \"p\", \"q\"" + (multi ? ", \"p_meta\"" : "") + "):",
    "        RESULT[f\"coexpression:{r.a}/{r.b}:{f}\"] = getattr(r, f)",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["pearsonFromMoments", ...(multi ? ["fisherZMeta"] : []), "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Pearson's r and p from the six sums match scipy " + VERIFIED.pearson.version + " pearsonr on the underlying values" +
      (multi ? ", and the Fisher-z meta-analysis statsmodels " + VERIFIED.meta.version + " " + VERIFIED.meta.fn : "") +
      ", to a relative 1e-6 (test/moments-golden.test.ts).",
    python: withResult(python),
    // r is reported to 4 decimals
    check: checks("coexpression:", t.results.filter((x) => x.r != null), (x) => x.a + "/" + x.b,
      [["r", "r", { abs: 5e-5 + 1e-12 }], ["p", "p"], ["q", "q"], ["pMeta", "p_meta"]]),
  };
}
