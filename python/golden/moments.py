# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "statsmodels==0.15.0",
#   "numpy==2.5.3",
#   "scipy==1.18.1",
# ]
# ///
"""Reference results for lib/stats.ts's moment- and rank-based tests.

Each case is generated as raw values, then handed to our functions in the form they receive in
production — (n, sum, sum of squares) moments, (value, count) histograms, or the six
correlation sums — while the reference libraries see the raw values. Writes
test/fixtures/golden/moments.json, checked by test/moments-golden.test.ts.

    uv run python/golden/moments.py
"""
import json
import pathlib

import numpy as np
import scipy
import statsmodels
from scipy.stats import kruskal, mannwhitneyu, norm, pearsonr, ttest_ind
from statsmodels.stats.meta_analysis import combine_effects
from statsmodels.stats.oneway import anova_generic

OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "moments.json"
rng = np.random.default_rng(51)


def moments(x):
    x = np.asarray(x, dtype=float)
    return {"n": int(x.size), "sum": float(x.sum()), "sumsq": float((x * x).sum())}


def histogram(x):
    v, n = np.unique(np.asarray(x, dtype=float), return_counts=True)
    return [{"v": float(a), "n": int(b)} for a, b in zip(v, n)]


def sample(kind, n, loc, scale):
    if kind == "integer":  # many ties, like age in years or a 0-10 score
        return np.round(rng.normal(loc, scale, n)).astype(float)
    return np.round(rng.normal(loc, scale, n), 3)


welch = []
for kind, n1, n2, d, s2 in [("continuous", 40, 55, 0.4, 1.0), ("continuous", 300, 120, 0.1, 2.5),
                            ("integer", 25, 30, 1.5, 1.2), ("continuous", 8, 600, 0.9, 0.5), ("integer", 1500, 1400, 0.3, 1.0)]:
    x, y = sample(kind, n1, 60, 10), sample(kind, n2, 60 + d * 10, 10 * s2)
    r = ttest_ind(x, y, equal_var=False)
    welch.append({"a": moments(x), "b": moments(y), "t": float(r.statistic), "df": float(r.df), "p": float(r.pvalue)})

anova = []
for ks in [(30, 45, 60), (200, 150, 90, 300), (12, 15, 9, 20, 11), (500, 520)]:
    gs = [sample("continuous", n, 50 + i * 1.5, 8 + i * 2) for i, n in enumerate(ks)]
    r = anova_generic(np.array([g.mean() for g in gs]), np.array([g.var(ddof=1) for g in gs]), np.array([g.size for g in gs]),
                      use_var="unequal", welch_correction=True)
    anova.append({"groups": [moments(g) for g in gs], "f": float(r.statistic), "df1": float(r.df[0]), "df2": float(r.df[1]),
                  "p": float(r.pvalue)})

ranks = []
for kind, ns in [("integer", (40, 50)), ("continuous", (35, 60)), ("integer", (300, 280)), ("integer", (20, 25, 30)),
                 ("continuous", (50, 40, 45, 60)), ("integer", (400, 380, 410))]:
    gs = [sample(kind, n, 40 + i * 1.2, 6) for i, n in enumerate(ns)]
    case = {"groups": [histogram(g) for g in gs],
            "quantiles": [[float(q) for q in np.percentile(g, [50, 25, 75])] for g in gs]}
    if len(gs) == 2:
        r = mannwhitneyu(gs[0], gs[1], alternative="two-sided", use_continuity=True, method="asymptotic")
        u1 = float(r.statistic)
        case["mannWhitney"] = {"u": min(u1, len(gs[0]) * len(gs[1]) - u1), "p": float(r.pvalue)}
    r = kruskal(*gs)
    case["kruskal"] = {"h": float(r.statistic), "p": float(r.pvalue), "df": len(gs) - 1}
    ranks.append(case)

pearson = []
for n, rho in [(30, 0.5), (200, -0.2), (1000, 0.05), (15, 0.9), (5000, 0.31)]:
    xy = rng.multivariate_normal([0, 0], [[1, rho], [rho, 1]], n)
    x, y = np.round(xy[:, 0], 4), np.round(xy[:, 1] * 3 + 7, 4)
    r = pearsonr(x, y)
    pearson.append({"moments": {"n": n, "sx": float(x.sum()), "sy": float(y.sum()), "sxy": float((x * y).sum()),
                                "sxx": float((x * x).sum()), "syy": float((y * y).sum())},
                    "r": float(r.statistic), "p": float(r.pvalue)})

meta = []
for parts in [[(0.3, 50), (0.45, 120), (0.2, 80)], [(-0.1, 400), (0.05, 300)], [(0.6, 20), (0.55, 25), (0.7, 18), (0.4, 60)]]:
    z = np.array([np.arctanh(r) for r, _ in parts]); var = np.array([1 / (n - 3) for _, n in parts])
    res = combine_effects(z, var, method_re="chi2")
    z_fe, se_fe = float(res.mean_effect_fe), float(res.sd_eff_w_fe)
    meta.append({"parts": [{"r": r, "n": n} for r, n in parts], "z": z_fe, "se": se_fe, "r": float(np.tanh(z_fe)),
                 "p": float(2 * norm.sf(abs(z_fe / se_fe)))})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/moments.py",
    "libraries": {"statsmodels": statsmodels.__version__, "numpy": np.__version__, "scipy": scipy.__version__},
    "reference": {"welch": "scipy ttest_ind(equal_var=False)",
                  "anova": "statsmodels anova_generic(use_var='unequal', welch_correction=True)",
                  "mannWhitney": "scipy mannwhitneyu(two-sided, use_continuity=True, method='asymptotic')",
                  "kruskal": "scipy kruskal", "quantiles": "numpy percentile (linear)",
                  "pearson": "scipy pearsonr", "meta": "statsmodels combine_effects, fixed effect"},
    "welch": welch, "anova": anova, "ranks": ranks, "pearson": pearson, "meta": meta,
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(welch)} Welch, {len(anova)} ANOVA, {len(ranks)} rank, "
      f"{len(pearson)} Pearson, {len(meta)} meta cases")
