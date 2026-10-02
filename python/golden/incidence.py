# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "lifelines==0.30.3",
#   "statsmodels==0.15.0",
#   "numpy==2.5.3",
#   "pandas==2.3.3",
#   "scipy==1.18.1",
# ]
# ///
"""Reference results for lib/stats.ts's aalenJohansen and grayPermutationTest.

Cumulative incidence and its delta-method standard error from statsmodels' CumIncidenceRight
(tied times handled exactly); with delayed entry, which statsmodels does not take, the incidence
from lifelines' AalenJohansenFitter on tie-free times (lifelines jitters ties). Gray's statistic
and its permutation p rest on our seeded shuffle, so they come from gray_null.py, the Python port
the incidence view's script carries. Writes test/fixtures/golden/incidence.json, checked by
test/incidence-golden.test.ts.

    uv run python/golden/incidence.py
"""
import json
import pathlib
import sys
import warnings

import lifelines
import numpy as np
import pandas as pd
import scipy
import statsmodels
from lifelines import AalenJohansenFitter
from statsmodels.duration.survfunc import CumIncidenceRight

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gray_null import gray_permutation_test  # noqa: E402

warnings.simplefilter("ignore")
OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "incidence.json"
rng = np.random.default_rng(71)


def records(n, h1, h2, ties, entry=False):
    t1, t2, tc = rng.exponential(1 / h1, n), rng.exponential(1 / h2, n), rng.exponential(40, n)
    t = np.minimum(np.minimum(t1, t2), tc)
    cause = np.where(t == t1, 1, np.where(t == t2, 2, 0))
    t = np.maximum(np.round(t), 1.0) if ties else np.round(t, 5)
    e = np.round(t * rng.uniform(0, 0.5, n), 5) if entry else None
    return [{"t": float(t[i]), "cause": int(cause[i]), **({"entry": float(e[i])} if entry else {})} for i in range(n)]


cif = []
for n, h1, h2 in [(300, 0.02, 0.03), (120, 0.05, 0.01), (600, 0.01, 0.04)]:
    recs = records(n, h1, h2, ties=True)
    c = CumIncidenceRight(np.array([r["t"] for r in recs]), np.array([r["cause"] for r in recs]))
    cif.append({"records": recs, "times": c.times.tolist(), "f1": c.cinc[0].tolist(), "f2": c.cinc[1].tolist(),
                "se1": [None if not np.isfinite(x) else float(x) for x in c.cinc_se[0]]})

entry_cif = []
for n in (200, 400):
    recs = records(n, 0.03, 0.02, ties=False, entry=True)
    ajf = AalenJohansenFitter(calculate_variance=False).fit(
        [r["t"] for r in recs], [r["cause"] for r in recs], event_of_interest=1, entry=[r["entry"] for r in recs])
    cd = ajf.cumulative_density_.iloc[:, 0]
    event_times = sorted({r["t"] for r in recs if r["cause"] != 0})
    entry_cif.append({"records": recs, "points": [{"t": t, "f1": float(cd.loc[t])} for t in event_times]})

gray = []
for spec in [((150, 0.02, 0.03), (150, 0.035, 0.03)), ((80, 0.03, 0.01), (90, 0.03, 0.02), (70, 0.05, 0.01)),
             ((120, 0.02, 0.02), (130, 0.02, 0.02))]:
    groups = [records(n, h1, h2, ties=True) for n, h1, h2 in spec]
    stat, p = gray_permutation_test([[(r["t"], r["cause"], r.get("entry")) for r in g] for g in groups], permutations=300, seed=1)
    gray.append({"groups": groups, "permutations": 300, "statistic": stat, "p": p})
groups = [records(100, 0.03, 0.02, ties=True, entry=True), records(110, 0.045, 0.02, ties=True, entry=True)]
stat, p = gray_permutation_test([[(r["t"], r["cause"], r.get("entry")) for r in g] for g in groups], permutations=300, seed=1)
gray.append({"groups": groups, "permutations": 300, "statistic": stat, "p": p})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/incidence.py",
    "libraries": {"lifelines": lifelines.__version__, "statsmodels": statsmodels.__version__, "numpy": np.__version__,
                  "pandas": pd.__version__, "scipy": scipy.__version__},
    "reference": {"cif": "statsmodels CumIncidenceRight (F1, F2, SE of F1)", "entry": "lifelines AalenJohansenFitter(entry=…), tie-free",
                  "gray": "python/golden/gray_null.py (the incidence script's port of our seeded permutation test)"},
    "cif": cif, "entryCif": entry_cif, "gray": gray,
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(cif)} CIF, {len(entry_cif)} delayed-entry, {len(gray)} Gray cases")
