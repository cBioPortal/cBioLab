# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "gseapy==1.3.1",
#   "joblib==1.5.2",
#   "numpy==2.5.3",
#   "pandas==2.3.3",
# ]
# ///
"""Reference results for lib/stats.ts's preRankedGsea.

The enrichment score from gseapy's prerank (weight 1). The permutation p and NES cannot come
from a library, since they rest on our seeded null; they come from gsea_null.py, the Python
port of that null which the diffexpr view's script carries, so this fixture also proves the
port reproduces our numbers exactly. Writes test/fixtures/golden/gsea.json, checked by
test/gsea-golden.test.ts.

    uv run python/golden/gsea.py
"""
import json
import pathlib
import sys
import warnings

import gseapy
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gsea_null import preranked_gsea  # noqa: E402

warnings.simplefilter("ignore")
OUT = pathlib.Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden" / "gsea.json"
rng = np.random.default_rng(61)

n = 1500
genes = [f"G{i:04d}" for i in range(n)]
scores = np.round(np.sort(rng.normal(0, 2.5, n))[::-1], 4)
ranked = list(zip(genes, scores.tolist()))
sets = {
    "TOP_SKEWED": [genes[i] for i in sorted(rng.choice(300, 40, replace=False))],
    "BOTTOM_SKEWED": [genes[i] for i in sorted(rng.choice(np.arange(n - 250, n), 35, replace=False))],
    "RANDOM_SMALL": [genes[i] for i in rng.choice(n, 12, replace=False)],
    "RANDOM_LARGE": [genes[i] for i in rng.choice(n, 220, replace=False)],
    "MIDDLE": [genes[i] for i in range(700, 760)],
    "WITH_UNRANKED": [genes[i] for i in rng.choice(400, 25, replace=False)] + ["NOT_RANKED_1", "NOT_RANKED_2"],
}
PERMS = 200

ours = preranked_gsea(ranked, sets, permutations=PERMS, min_size=10)
gp = gseapy.prerank(rnk=pd.Series(scores, index=genes), gene_sets=sets, permutation_num=10, min_size=10, max_size=5000,
                    weight=1, seed=1, outdir=None, verbose=False, threads=1).res2d.set_index("Term")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "generatedBy": "python/golden/gsea.py",
    "libraries": {"gseapy": gseapy.__version__, "numpy": np.__version__, "pandas": pd.__version__},
    "reference": {"es": "gseapy prerank (weight=1) ES", "p, nes": "python/golden/gsea_null.py (the diffexpr script's port of our seeded null)"},
    "ranked": [{"gene": g, "score": s} for g, s in ranked],
    "sets": [{"name": k, "genes": v} for k, v in sets.items()],
    "permutations": PERMS,
    "expected": [{"name": k, "size": ours[k][0], "es": ours[k][1], "esGseapy": float(gp.loc[k, "ES"]),
                  "nes": ours[k][2], "p": ours[k][3]} for k in sets if k in ours],
}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(OUT.parents[3])}: {len(ours)} sets")
