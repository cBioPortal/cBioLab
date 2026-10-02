# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "statsmodels==0.15.0",
#   "numpy==2.5.3",
#   "scipy==1.18.1",
# ]
# ///
"""Reference results for lib/stats.ts's contingency-table tests.

fisherExact (scipy fisher_exact, two-sided), chiSquareTest (scipy chi2_contingency without the
continuity correction), benjaminiHochberg (statsmodels multipletests fdr_bh) and
cochranMantelHaenszel (statsmodels StratifiedTable: the test of a common odds ratio of 1, with
R's continuity-correction rule, and the Mantel-Haenszel pooled odds ratio). Writes test/fixtures/golden/tables.json,
which test/tables-golden.test.ts checks our implementation against.

    uv run python/golden/tables.py
"""
import json
import pathlib

import numpy as np
import scipy
import statsmodels
from scipy.stats import chi2 as chi2_dist, chi2_contingency, fisher_exact
from statsmodels.stats.contingency_tables import StratifiedTable
from statsmodels.stats.multitest import multipletests

OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "tables.json"
rng = np.random.default_rng(41)

# 2x2 tables as [a, b, c, d] = [[a, b], [c, d]]
fisher_tables = [
    [3, 1, 1, 3], [0, 5, 5, 0], [0, 0, 4, 6], [10, 0, 0, 10], [1, 9, 11, 3],
    [12, 488, 3, 497], [250, 750, 180, 820], [5, 5, 5, 5], [0, 120, 4, 300],
    [1500, 8500, 1350, 8650], [40, 2, 3, 41], [7, 93, 1, 99],
]
fisher_tables += [[int(x) for x in rng.integers(0, 60, 4)] for _ in range(20)]
fisher = [{"table": t, "p": float(fisher_exact([[t[0], t[1]], [t[2], t[3]]], alternative="two-sided").pvalue)} for t in fisher_tables]

# r x c tables; a zero row or column is dropped first, as chiSquareTest does
def chi2(table):
    t = np.array(table)
    t = t[t.sum(axis=1) > 0][:, t.sum(axis=0) > 0]
    res = chi2_contingency(t, correction=False)
    return {"table": table, "chi2": float(res.statistic), "df": int(res.dof), "p": float(res.pvalue),
            "minExpected": float(res.expected_freq.min())}

chi2_tables = [
    [[30, 70], [45, 55], [60, 40]],
    [[5, 95], [9, 91], [2, 98], [14, 86]],
    [[120, 880], [100, 900]],
    [[0, 50], [3, 47], [8, 42]],
    [[10, 20, 30], [20, 20, 20], [30, 20, 10]],
    [[3, 0, 7], [4, 0, 9]],
    [[2000, 8000], [2100, 7900], [1900, 8100], [2300, 7700], [2050, 7950]],
]
chi2_tables += [[[int(x) for x in rng.integers(1, 80, 3)] for _ in range(4)] for _ in range(6)]
chisq = [chi2(t) for t in chi2_tables]

# p-value families, including exact ties, ones and a long tail
bh_families = [
    [0.01, 0.04, 0.03, 0.005, 0.5],
    [0.001, 0.001, 0.002, 0.2, 0.2, 0.9, 1.0],
    [0.04],
    [1e-12, 0.03, 0.03, 0.03, 0.8, 0.049, 0.051],
    [float(x) for x in rng.uniform(0, 1, 40)],
    [float(x) for x in rng.beta(0.3, 4, 66)],
]
bh = [{"p": f, "q": [float(x) for x in multipletests(f, method="fdr_bh")[1]]} for f in bh_families]

# strata of 2x2 tables; one with an empty margin, which says nothing and is dropped
def cmh(strata):
    used = [s for s in strata if (s[0] + s[1]) and (s[2] + s[3]) and (s[0] + s[2]) and (s[1] + s[3]) and sum(s) >= 2]
    st = StratifiedTable([np.array([[s[0], s[1]], [s[2], s[3]]], dtype=float) for s in used])
    # R's mantelhaen.test convention: the 0.5 continuity correction only when |sum(a) - sum(E[a])| >= 0.5
    delta = abs(sum(s[0] - (s[0] + s[1]) * (s[0] + s[2]) / sum(s) for s in used))
    test = st.test_null_odds(correction=bool(delta >= 0.5))
    # p from the chi-squared tail: test_null_odds' own pvalue is 1 - cdf, which loses precision below ~1e-12
    return {"strata": strata, "chi2": float(test.statistic), "p": float(chi2_dist.sf(test.statistic, 1)),
            "oddsRatio": float(st.oddsratio_pooled), "tables": len(used)}

cmh_cases = [
    [[80, 20, 9, 1], [10, 90, 18, 72]],
    [[12, 30, 8, 50], [20, 25, 15, 40], [5, 60, 2, 70]],
    [[3, 7, 2, 8], [0, 0, 5, 5], [6, 4, 3, 7]],
    [[200, 800, 150, 850], [90, 910, 60, 940], [400, 600, 380, 620], [10, 90, 4, 96]],
]
cmh_cases += [[[int(x) for x in rng.integers(1, 50, 4)] for _ in range(int(rng.integers(2, 6)))] for _ in range(5)]
cmhs = [cmh(s) for s in cmh_cases]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/tables.py",
    "libraries": {"statsmodels": statsmodels.__version__, "numpy": np.__version__, "scipy": scipy.__version__},
    "reference": {"fisher": "scipy.stats.fisher_exact (two-sided)", "chi2": "scipy.stats.chi2_contingency(correction=False)",
                  "bh": "statsmodels multipletests(method='fdr_bh')",
                  "cmh": "statsmodels StratifiedTable.test_null_odds (continuity-corrected when |delta| >= 0.5, as R's mantelhaen.test), oddsratio_pooled"},
    "fisher": fisher, "chi2": chisq, "bh": bh, "cmh": cmhs,
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(fisher)} Fisher, {len(chisq)} chi2, {len(bh)} BH, {len(cmhs)} CMH cases")
