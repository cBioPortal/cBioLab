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
"""Reference results for lib/stats.ts's kaplanMeier, logRank and logRankK.

Kaplan-Meier from lifelines, log-rank (2 groups or k, pooled or stratified, with or without
delayed entry) from statsmodels' survdiff. Writes test/fixtures/golden/survival.json, which
test/survival-golden.test.ts checks our implementation against.

    uv run python/golden/survival.py
"""
import json
import pathlib

import lifelines
import numpy as np
import pandas as pd
import scipy
import statsmodels
from lifelines import KaplanMeierFitter
from statsmodels.duration.survfunc import survdiff

OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "survival.json"


def cohort(rng, n, hazard, censor_rate, ties, entry=False, entry_on_grid=False):
    t_ev = rng.exponential(1 / hazard, n)
    t_c = rng.exponential(1 / censor_rate, n)
    t = np.minimum(t_ev, t_c)
    ev = (t_ev <= t_c).astype(int)
    t = np.maximum(np.round(t), 1.0) if ties else np.round(t, 4)
    rec = {"t": t, "event": ev}
    if entry:
        # delayed entry: observable only from a random point before the exit time
        rec["entry"] = np.floor(t * rng.uniform(0, 0.6, n)) if entry_on_grid else np.round(t * rng.uniform(0, 0.6, n), 4)
    return pd.DataFrame(rec)


def records(df):
    return [{"t": float(r.t), "event": int(r.event), **({"entry": float(r.entry)} if "entry" in df else {})}
            for r in df.itertuples()]


def km_case(name, about, seed, n, ties, entry=False, entry_on_grid=False):
    rng = np.random.default_rng(seed)
    df = cohort(rng, n, 0.05, 0.02, ties, entry, entry_on_grid)
    km = KaplanMeierFitter().fit(df["t"], df["event"], entry=df["entry"] if entry else None)
    sf = km.survival_function_.iloc[:, 0]
    event_times = sorted(set(df.loc[df["event"] == 1, "t"]))
    return {
        "name": name, "about": about, "rows": records(df),
        "expected": {
            "points": [{"t": float(t), "s": float(sf.loc[t])} for t in event_times],
            "median": None if np.isinf(km.median_survival_time_) else float(km.median_survival_time_),
            "n": n, "events": int(df["event"].sum()),
        },
    }


def logrank_case(name, about, seed, groups, strata, ties, entry=False, entry_on_grid=False):
    """groups: per-group hazards; strata: how many sites, each with its own baseline."""
    rng = np.random.default_rng(seed)
    parts = []
    for s in range(strata):
        base = [1.0, 2.5, 0.6, 1.8][s]
        for g, h in enumerate(groups):
            df = cohort(rng, int(rng.integers(40, 140)), 0.03 * h * base, 0.02, ties, entry, entry_on_grid)
            df["group"], df["stratum"] = g, s
            parts.append(df)
    df = pd.concat(parts, ignore_index=True)
    stat, p = survdiff(df["t"].to_numpy(), df["event"].to_numpy(), df["group"].to_numpy(),
                       strata=df["stratum"].to_numpy() if strata > 1 else None,
                       entry=df["entry"].to_numpy() if entry else None)
    return {
        "name": name, "about": about, "groups": len(groups),
        "strata": [[records(df[(df.stratum == s) & (df.group == g)]) for g in range(len(groups))] for s in range(strata)],
        "expected": {"chi2": float(stat), "p": float(p), "df": len(groups) - 1},
    }


km = [
    km_case("distinct times", "no tied times, no delayed entry", seed=21, n=150, ties=False),
    km_case("heavy ties", "integer months: several events and censorings at the same time", seed=22, n=300, ties=True),
    km_case("delayed entry", "left-truncated: each patient is at risk only after entering", seed=23, n=250, ties=True, entry=True),
    km_case("entries on event times", "integer entries coincide with event times: a patient entering at t is not at risk at t",
            seed=24, n=250, ties=True, entry=True, entry_on_grid=True),
]
logrank = [
    logrank_case("two groups, pooled", "the plain two-sample log-rank", seed=31, groups=[1.0, 1.6], strata=1, ties=True),
    logrank_case("two groups, stratified by three sites", "each site its own risk set, summed (federated default)",
                 seed=32, groups=[1.0, 1.4], strata=3, ties=True),
    logrank_case("two groups, delayed entry", "risk sets honour entry times", seed=33, groups=[1.0, 1.5], strata=1, ties=True, entry=True),
    logrank_case("two groups, entries on event times", "a patient entering at t is not in the risk set at t",
                 seed=36, groups=[1.0, 1.5], strata=1, ties=True, entry=True, entry_on_grid=True),
    logrank_case("three groups, pooled", "k-group log-rank on 2 df", seed=34, groups=[1.0, 1.3, 1.8], strata=1, ties=True),
    logrank_case("four groups, stratified by two sites", "k-group, stratified", seed=35, groups=[1.0, 1.2, 0.8, 1.5], strata=2, ties=False),
]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/survival.py",
    "libraries": {"lifelines": lifelines.__version__, "statsmodels": statsmodels.__version__,
                  "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__},
    "reference": {"km": "lifelines KaplanMeierFitter", "logrank": "statsmodels.duration.survfunc.survdiff"},
    "km": km, "logrank": logrank,
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(km)} KM, {len(logrank)} log-rank cases")
