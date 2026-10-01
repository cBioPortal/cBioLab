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
"""Reference fits for lib/stats.ts's coxRegression and logisticRegression.

Fits each dataset below with lifelines (Cox, Efron ties) and statsmodels (logistic) and writes
the data plus the reference results to test/fixtures/golden/regression.json, which
test/regression-golden.test.ts checks our implementation against.

    uv run python/golden/regression.py

The library versions are pinned in the header above, so re-running this regenerates the same
fixture. The datasets are synthetic and seeded; their values are rounded before fitting, and the
rounded values are what the fixture stores, so both sides fit exactly the same numbers.
"""
import json
import pathlib

import lifelines
import numpy as np
import pandas as pd
import scipy
import statsmodels
import statsmodels.api as sm
from lifelines import CoxPHFitter

OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "regression.json"


def covariates(rng, n, kinds):
    """Columns of a design matrix: "bin" (0/1), "age" (raw years, deliberately unscaled) or
    "cat3" (a three-level categorical, dummy-coded against its first level -> two columns)."""
    cols, names = [], []
    for i, kind in enumerate(kinds):
        if kind == "bin":
            cols.append(rng.binomial(1, 0.35, n).astype(float)); names.append(f"bin{i}")
        elif kind == "age":
            cols.append(np.round(rng.normal(62, 11, n), 1)); names.append(f"age{i}")
        elif kind == "cat3":
            level = rng.choice(3, n, p=[0.5, 0.3, 0.2])
            cols.append((level == 1).astype(float)); names.append(f"cat{i}_b")
            cols.append((level == 2).astype(float)); names.append(f"cat{i}_c")
    return np.column_stack(cols), names


def cox_case(name, about, seed, n, kinds, beta, ties, strata=1, censor=0.35):
    rng = np.random.default_rng(seed)
    X, names = covariates(rng, n, kinds)
    stratum = rng.integers(0, strata, n)
    baseline = np.array([0.02, 0.05, 0.01, 0.08])[stratum]  # per-stratum baseline hazard, per month
    t_event = rng.exponential(1 / (baseline * np.exp(X @ np.array(beta))))
    t_cens = rng.exponential(np.quantile(t_event, 0.5) / censor, n)
    t = np.minimum(t_event, t_cens)
    event = (t_event <= t_cens).astype(int)
    # integer months produce heavy ties (Efron's correction matters); 6 decimals keeps times distinct
    t = np.maximum(np.round(t), 1.0) if ties else np.round(t, 6)

    df = pd.DataFrame(X, columns=names)
    df["t"], df["event"] = t, event
    if strata > 1:
        df["stratum"] = stratum
    cph = CoxPHFitter()
    cph.fit(df, duration_col="t", event_col="event", strata=["stratum"] if strata > 1 else None,
            fit_options={"precision": 1e-12, "max_steps": 500})
    s = cph.summary.loc[names]
    rows = [{"t": float(t[i]), "event": int(event[i]), "x": [float(v) for v in X[i]],
             **({"stratum": f"s{stratum[i]}"} if strata > 1 else {})} for i in range(n)]
    return {
        "name": name, "about": about, "terms": names, "rows": rows,
        "expected": {
            "beta": s["coef"].tolist(), "se": s["se(coef)"].tolist(), "p": s["p"].tolist(),
            "ciLow": s["exp(coef) lower 95%"].tolist(), "ciHigh": s["exp(coef) upper 95%"].tolist(),
            "loglik": float(cph.log_likelihood_), "n": n, "events": int(event.sum()),
        },
    }


def logistic_case(name, about, seed, n, kinds, beta, intercept):
    rng = np.random.default_rng(seed)
    X, names = covariates(rng, n, kinds)
    eta = intercept + X @ np.array(beta)
    y = rng.binomial(1, 1 / (1 + np.exp(-eta)))
    fit = sm.Logit(y, sm.add_constant(X)).fit(method="newton", tol=1e-12, maxiter=200, disp=0)
    ci = np.exp(fit.conf_int())
    rows = [{"y": int(y[i]), "x": [float(v) for v in X[i]]} for i in range(n)]
    return {
        "name": name, "about": about, "terms": names, "rows": rows,
        "expected": {
            "intercept": float(fit.params[0]),
            "beta": fit.params[1:].tolist(), "se": fit.bse[1:].tolist(), "p": fit.pvalues[1:].tolist(),
            "ciLow": ci[1:, 0].tolist(), "ciHigh": ci[1:, 1].tolist(),
            "loglik": float(fit.llf), "n": n, "events": int(y.sum()),
        },
    }


cox = [
    cox_case("one binary covariate, distinct times", "the simplest model: no ties, so Efron's correction is inactive",
             seed=1, n=200, kinds=["bin"], beta=[0.7], ties=False),
    cox_case("mixed covariates, heavy ties", "binary + unscaled age + a 3-level categorical; integer-month times put many deaths at the same time",
             seed=2, n=300, kinds=["bin", "age", "cat3"], beta=[0.5, 0.03, 0.4, -0.6], ties=True),
    cox_case("stratified by study", "three strata with different baseline hazards, each its own risk set (stratifyByStudy)",
             seed=3, n=360, kinds=["bin", "age"], beta=[-0.4, 0.02], ties=True, strata=3),
    cox_case("small sample", "25 patients with ties: wide intervals, where a numerical shortcut would show",
             seed=4, n=25, kinds=["bin", "age"], beta=[0.8, 0.04], ties=True),
    cox_case("large effect", "HR around 8: a large first Newton step from beta=0, the case step-halving exists for",
             seed=5, n=150, kinds=["bin"], beta=[2.1], ties=True),
]
logistic = [
    logistic_case("one binary covariate", "the simplest model: a single 0/1 predictor",
                  seed=11, n=300, kinds=["bin"], beta=[0.9], intercept=-0.5),
    logistic_case("mixed covariates", "binary + unscaled age + a 3-level categorical",
                  seed=12, n=500, kinds=["bin", "age", "cat3"], beta=[0.6, 0.04, -0.5, 0.8], intercept=-3.0),
    logistic_case("rare outcome", "about 4% events: the baseline rate the intercept has to carry",
                  seed=13, n=800, kinds=["bin", "age"], beta=[1.0, 0.02], intercept=-4.6),
    logistic_case("small sample", "40 patients: wide intervals",
                  seed=14, n=40, kinds=["bin", "age"], beta=[1.2, 0.05], intercept=-3.0),
]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/regression.py",
    "libraries": {"lifelines": lifelines.__version__, "statsmodels": statsmodels.__version__,
                  "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__},
    "reference": {"cox": "lifelines CoxPHFitter (Efron ties, no penalizer)",
                  "logistic": "statsmodels Logit (Newton), 95% Wald intervals"},
    "cox": cox, "logistic": logistic,
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(cox)} cox, {len(logistic)} logistic cases")
