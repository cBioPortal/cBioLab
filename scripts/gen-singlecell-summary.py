# /// script
# requires-python = ">=3.11"
# dependencies = ["zarr>=3", "fsspec", "aiohttp", "requests", "pandas", "numpy"]
# ///
"""Single-cell cell metadata summarised per patient and per sample, as custom datasets for a study.

A dataset on cBioPortal Cell Explorer (cell-explorer.cbioportal.org) is an AnnData zarr in a public
bucket. This reads only its obs columns and turns them into numbers the lab reads like clinical
attributes: the share of cells in each label (a cell type, a cluster, a state) and the mean of each
per-cell score, for every patient and every sample the study and the dataset share.

Two modes:

  propose   draft a config for a Cell Explorer dataset and a cBioPortal study: which obs column
            names the patient and which the sample, how each maps to the study's ids (directly, or
            through a sample attribute such as H5AD_SAMPLE_ID), and which columns look like labels
            and scores. The draft says how many ids matched; a person reviews it before use.
  build     run a config: write <id>-patients and <id>-samples as TSV (for Explore → Custom data)
            and as one JSON array of datasets (the lab's inline customData).

  uv run scripts/gen-singlecell-summary.py propose <cell-explorer slug> <study> > config.json
  uv run scripts/gen-singlecell-summary.py build config.json --out DIR [--ts lib/x.ts --export NAME]

What it does not decide: anything a paper's design needs — a sorting correction, which sites to pool,
cut-offs on a score. Those stay a dataset's own script (scripts/gen-spectrum-sc-demo.py).
"""
import argparse, json, re, sys
from pathlib import Path

import numpy as np, pandas as pd, requests, zarr

CATALOG = "https://cell-explorer.cbioportal.org/api/datasets"
PORTAL = "https://www.cbioportal.org/api/studies/"
# CELLxGENE schema columns: never a label or a score worth summarising
STANDARD = re.compile(r"(_ontology_term_id|^observation_joinid$|^is_primary_data$|^suspension_type$|^tissue_type$|^assay$|"
                      r"^organism$|^sex$|^self_reported_ethnicity$|^development_stage$|^disease$|^donor_id$|^_index$)")
SCORE = re.compile(r"score|module|pathway|signature|program", re.I)
QC = re.compile(r"count|percent|pct|n_genes|nfeature|ncount|doublet|mito|ribo|^total|log1p", re.I)
MAX_LABELS = 40


def col(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", str(s)).strip("_")[:60] or "x"


# ---- reading a Cell Explorer zarr ------------------------------------------------------------

def open_obs(url: str):
    return zarr.open_group(url, mode="r")["obs"]


def read_col(obs, name: str) -> pd.Series:
    o = obs[name]
    if isinstance(o, zarr.Group):
        cats = np.array([str(x) for x in o["categories"][:]], dtype=object)
        codes = np.asarray(o["codes"][:])
        return pd.Series(np.where(codes >= 0, cats[np.clip(codes, 0, None)], None), dtype=object)
    a = np.asarray(o[:])
    return pd.Series([str(x) for x in a] if a.dtype.kind in "OSUT" else a)


def portal(path: str):
    r = requests.get(PORTAL + path, timeout=120)
    r.raise_for_status()
    return r.json()


def study_ids(study: str):
    patients = {x["patientId"] for x in portal(study + "/patients?pageSize=100000")}
    samples = {x["sampleId"]: x["patientId"] for x in portal(study + "/samples?pageSize=100000")}
    attrs: dict[str, dict[str, str]] = {}
    for x in portal(study + "/clinical-data?clinicalDataType=SAMPLE&pageSize=1000000"):
        attrs.setdefault(x["clinicalAttributeId"], {})[x["value"]] = x["sampleId"]
    pattrs: dict[str, dict[str, str]] = {}
    for x in portal(study + "/clinical-data?clinicalDataType=PATIENT&pageSize=1000000"):
        pattrs.setdefault(x["clinicalAttributeId"], {})[x["value"]] = x["patientId"]
    return patients, samples, attrs, pattrs


# ---- propose ---------------------------------------------------------------------------------

def best_crosswalk(values: set[str], ids: set[str], by_attr: dict[str, dict[str, str]]):
    """the id mapping that matches the most values: the ids themselves, or one attribute's values"""
    best = {"attribute": None, "matched": len(values & ids)}
    for a, m in by_attr.items():
        n = len(values & set(m))
        if n > best["matched"]:
            best = {"attribute": a, "matched": n}
    return best


def propose(slug: str, study: str) -> dict:
    cat = requests.get(CATALOG + "/" + slug, timeout=60).json()
    if "url" not in cat:
        sys.exit("no Cell Explorer dataset " + slug)
    meta = {c["name"]: c for c in cat["metadata"]["obs_columns"]}
    obs = open_obs(cat["url"])
    patients, samples, sattrs, pattrs = study_ids(study)
    if "donor_id" not in meta:
        sys.exit(slug + " has no donor_id column")
    donors = set(read_col(obs, "donor_id").dropna().unique())
    pw = best_crosswalk(donors, patients, pattrs)
    n_donors = len(donors)
    # a sample column: categorical, more values than donors, matching the study's sample ids or one of its sample attributes
    sample = None
    for name, c in meta.items():
        if c["dtype"] != "categorical" or STANDARD.search(name) or not c["cardinality"] or c["cardinality"] <= n_donors:
            continue
        if c["cardinality"] > 5000:
            continue
        vals = set(read_col(obs, name).dropna().unique())
        sw = best_crosswalk(vals, set(samples), sattrs)
        if sw["matched"] and (sample is None or sw["matched"] > sample["matched"]):
            sample = {"obs": name, **sw, "values": len(vals)}
    # a cell label varies between a sample's cells; a column that never does describes the sample, not the cell
    unit = read_col(obs, sample["obs"] if sample else "donor_id")
    def varies(name: str) -> bool:
        return bool((read_col(obs, name).groupby(unit).nunique() > 1).any())
    labels = [n for n, c in meta.items() if c["dtype"] == "categorical" and not STANDARD.search(n)
              and c["cardinality"] and 2 <= c["cardinality"] <= MAX_LABELS and (not sample or n != sample["obs"]) and varies(n)]
    scores = [n for n, c in meta.items() if c["dtype"] == "numeric" and SCORE.search(n) and not QC.search(n)]
    return {
        "study": study,
        "id": col(slug).lower().replace("_", "-")[:30] + "-sc",
        "name": cat["name"],
        "cellExplorer": slug,
        "patient": {"obs": "donor_id", "attribute": pw["attribute"],
                    "_matched": f"{pw['matched']} of {n_donors} donors are patients of {study} ({len(patients)} patients)"},
        "sample": None if not sample else {"obs": sample["obs"], "attribute": sample["attribute"],
                                            "_matched": f"{sample['matched']} of {sample['values']} values are samples of {study} ({len(samples)} samples)"},
        "sources": [{"zarr": cat["url"], "prefix": col(slug.split("-")[-1]).upper()[:6],
                     "labels": labels, "scores": scores, "where": {}}],
        "minCells": 50, "minScoreCells": 20,
        "_review": "labels and scores were picked by column type and name: keep the ones that mean something, "
                   "and add a `where` filter (e.g. tumour samples only) where pooling all cells would mislead",
    }


# ---- build -----------------------------------------------------------------------------------

def build(cfg: dict):
    study = cfg["study"]
    patients, samples, sattrs, pattrs = study_ids(study)
    pmap = (lambda v: v if v in patients else None) if not cfg["patient"].get("attribute") else \
        (lambda v, m=pattrs.get(cfg["patient"]["attribute"], {}): m.get(v))
    sc = cfg.get("sample")
    smap = None
    if sc:
        smap = (lambda v: v if v in samples else None) if not sc.get("attribute") else \
            (lambda v, m=sattrs.get(sc["attribute"], {}): m.get(v))
    min_cells, min_score = cfg.get("minCells", 50), cfg.get("minScoreCells", 20)
    per_p, per_s, report = [], [], []
    for src in cfg["sources"]:
        want = {cfg["patient"]["obs"], *src.get("labels", []), *src.get("scores", []), *src.get("where", {}).keys()}
        if sc:
            want.add(sc["obs"])
        # one source may span several files with the same columns (a discovery and a validation set)
        urls = src["zarr"] if isinstance(src["zarr"], list) else [src["zarr"]]
        frames = []
        for u in urls:
            obs = open_obs(u)
            frames.append(pd.DataFrame({c: read_col(obs, c) for c in want}))
        df = pd.concat(frames, ignore_index=True)
        for c, keep in src.get("where", {}).items():
            df = df[df[c].isin(keep)]
        df["_patient"] = df[cfg["patient"]["obs"]].map(pmap)
        if sc:
            df["_sample"] = df[sc["obs"]].map(smap)
        pre = src["prefix"]
        for unit, key, out in (("patient", "_patient", per_p), ("sample", "_sample", per_s)):
            if key not in df:
                continue
            d = df[df[key].notna()]
            n = d.groupby(key).size()
            parts = [n.rename(pre + "_N_CELLS")]
            for lab in src.get("labels", []):
                frac = d.groupby([key, lab]).size().unstack(fill_value=0).div(n, axis=0).where(n >= min_cells, axis=0)
                frac.columns = [pre + "_" + col(lab) + "_" + col(v) for v in frac.columns]
                parts.append(frac)
            for s in src.get("scores", []):
                v = pd.to_numeric(d[s], errors="coerce")
                m = v.groupby(d[key]).mean().where(v.groupby(d[key]).count() >= min_score)
                parts.append(m.rename(pre + "_SCORE_" + col(s)))
            out.append(pd.concat(parts, axis=1))
            report.append(f"{pre} {unit}: {d[key].nunique()} matched, {len(df) - len(d)} cells unmatched")
    def merge(frames):
        return pd.concat(frames, axis=1) if frames else pd.DataFrame()
    return merge(per_p), merge(per_s), samples, report


def fmt(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return ""
    return f"{v:.4g}" if isinstance(v, (float, np.floating)) else str(v)


def datasets(cfg, P, S, samples):
    out = []
    for level, df in (("patient", P), ("sample", S)):
        if df.empty:
            continue
        df = df.loc[:, df.notna().any()]
        for k, chunk in enumerate(range(0, len(df.columns), 64)):
            cols = list(df.columns[chunk:chunk + 64])
            slug = (cfg["id"] + "-" + level[0] + ("" if k == 0 else str(k + 1)))[:40]
            rows = [{"study": cfg["study"], "patient": samples[i] if level == "sample" else i, **({"sample": i} if level == "sample" else {}),
                     "values": [fmt(v) for v in df.loc[i, cols]]} for i in sorted(df.index)]
            out.append({"id": slug, "name": cfg["name"] + " — per " + level + ("" if k == 0 else " (" + str(k + 1) + ")"), "level": level,
                        "columns": [{"name": c, "datatype": "NUMBER"} for c in cols], "rows": rows})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("propose"); p.add_argument("slug"); p.add_argument("study")
    b = sub.add_parser("build"); b.add_argument("config"); b.add_argument("--out", required=True)
    b.add_argument("--ts"); b.add_argument("--export")
    a = ap.parse_args()
    if a.cmd == "propose":
        json.dump(propose(a.slug, a.study), sys.stdout, indent=1, ensure_ascii=False); print()
        return
    cfg = json.load(open(a.config))
    P, S, samples, report = build(cfg)
    ds = datasets(cfg, P, S, samples)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for d in ds:
        head = ["SAMPLE_ID" if d["level"] == "sample" else "PATIENT_ID"] + [c["name"] for c in d["columns"]]
        lines = ["\t".join(head)] + ["\t".join([r.get("sample", r["patient"])] + r["values"]) for r in d["rows"]]
        (out / (d["id"] + ".tsv")).write_text("\n".join(lines) + "\n")
    (out / (cfg["id"] + ".json")).write_text(json.dumps(ds, ensure_ascii=False))
    if a.ts:
        body = ",\n".join("  " + json.dumps({k: v for k, v in d.items() if k != "rows"}, ensure_ascii=False)[:-1] + ', "rows": [\n' +
                          ",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in d["rows"]) + "\n  ] }" for d in ds)
        Path(a.ts).write_text(f"// GENERATED by scripts/gen-singlecell-summary.py from {Path(a.config).name} — do not edit.\n"
                              + "".join(f"// {line}\n" for line in report)
                              + 'import type { CustomDataset } from "./custom-data-names.ts";\n\n'
                              + f"export const {a.export}: CustomDataset[] = [\n{body}\n];\n")
    for line in report:
        print(line, file=sys.stderr)
    for d in ds:
        print(f"{d['id']}: {d['level']}, {len(d['rows'])} rows, {len(d['columns'])} columns", file=sys.stderr)


if __name__ == "__main__":
    main()
