# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "scikit-survival==0.28.0",
#   "scikit-learn==1.9.1",
#   "lifelines==0.30.3",
#   "statsmodels==0.15.0",
#   "scipy==1.18.1",
#   "numpy==2.5.3",
#   "pandas==2.3.3",
# ]
# ///
"""Reference fits for lib/coxnet.ts.

  - the elastic-net Cox path: scikit-survival's CoxnetSurvivalAnalysis (glmnet's algorithm and
    objective, Breslow ties), at fixed penalties, on data with tied event times;
  - delayed entry and strata, unpenalised (coefficients, standard errors, p-values, log-likelihood):
    statsmodels' PHReg with entry / strata and Breslow ties. (lifelines' CoxPHFitter agrees when
    stratified but stops about 5e-6 short without strata, so it is not the reference here.)
  - Harrell's concordance: lifelines.utils.concordance_index, on the same untied data.

Writes the data and the reference results to test/fixtures/golden/coxnet.json, which
test/coxnet-golden.test.ts checks against.

    uv run python/golden/coxnet.py

Versions are pinned above; the datasets are synthetic, seeded, and rounded before fitting, and
the rounded values are what the fixture stores, so both sides fit exactly the same numbers.
"""
import json
import pathlib

import lifelines
import numpy as np
import sksurv
import statsmodels
from statsmodels.duration.hazard_regression import PHReg
from lifelines.utils import concordance_index
from sksurv.linear_model import CoxnetSurvivalAnalysis
from sksurv.util import Surv

OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "coxnet.json"


def dataset(seed, n, freqs, dense, tied, entry):
    rng = np.random.default_rng(seed)
    X = np.column_stack([rng.random(n) < f for f in freqs] + [np.round(rng.normal(0, 1, n), 3) for _ in range(dense)]).astype(float)
    beta = np.array([0.8, -0.6, 0.5, 0, 0, 0.3, 0, 0, -0.4, 0, 0, 0][: len(freqs)] + [0.3, 0][:dense])
    hazard = np.exp(X @ beta)
    t = rng.exponential(1 / hazard) * 20
    c = rng.exponential(30, n)
    time = np.minimum(t, c)
    event = t <= c
    time = np.round(time, 0) + 1 if tied else np.round(time, 6) + 1e-3 * np.arange(n) / n
    ent = np.round(rng.uniform(0, 0.5, n) * time, 6) if entry else np.zeros(n)
    stratum = rng.integers(0, 3, n)
    return X, time, event, ent, stratum


def main():
    cases = []

    # 1. elastic-net path, tied times, no entry, one stratum
    freqs = [0.4, 0.3, 0.2, 0.15, 0.1, 0.35, 0.05, 0.25, 0.3, 0.12, 0.08, 0.2]
    X, time, event, ent, _ = dataset(11, 400, freqs, 2, tied=True, entry=False)
    alphas = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002]
    for l1 in [0.5, 1.0]:
        m = CoxnetSurvivalAnalysis(l1_ratio=l1, alphas=alphas, tol=1e-12, max_iter=1_000_000, fit_baseline_model=False)
        m.fit(X, Surv.from_arrays(event, time))
        cases.append({"name": f"path l1_ratio={l1}", "kind": "path", "alpha": l1, "lambdas": alphas,
                      "nbinary": len(freqs), "X": X.tolist(), "time": time.tolist(), "event": event.tolist(),
                      "entry": ent.tolist(), "stratum": [0] * len(time), "coefs": m.coef_.T.tolist()})

    # 2. unpenalised Cox with delayed entry and strata, untied times
    X, time, event, ent, stratum = dataset(23, 300, [0.4, 0.3, 0.25], 1, tied=False, entry=True)
    for strata in [False, True]:
        m = PHReg(time, X, status=event.astype(float), entry=ent, strata=stratum if strata else None, ties="breslow").fit(gtol=1e-12)
        cases.append({"name": "unpenalised, delayed entry" + (", 3 strata" if strata else ""), "kind": "cox",
                      "nbinary": 3, "X": X.tolist(), "time": time.tolist(), "event": event.tolist(), "entry": ent.tolist(),
                      "stratum": stratum.tolist() if strata else [0] * len(time),
                      "coefs": m.params.tolist(), "loglik": float(m.llf), "se": m.bse.tolist(), "p": m.pvalues.tolist()})

    # 3. Harrell's C on held-out style scores
    rng = np.random.default_rng(5)
    score = np.round(X @ np.array([0.7, -0.4, 0.2, 0.3]) + rng.normal(0, 0.5, len(time)), 4)
    cases.append({"name": "concordance", "kind": "concordance", "time": time.tolist(), "event": event.tolist(),
                  "risk": score.tolist(), "c": concordance_index(time, -score, event)})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"versions": {"scikit-survival": sksurv.__version__, "lifelines": lifelines.__version__, "statsmodels": statsmodels.__version__,
                                            "numpy": np.__version__}, "cases": cases}) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
