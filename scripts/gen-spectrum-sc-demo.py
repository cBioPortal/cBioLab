# /// script
# requires-python = ">=3.11"
# dependencies = ["h5py", "fsspec", "aiohttp", "requests", "pandas", "numpy"]
# ///
"""Regenerates lib/spectrum-sc-demo.ts, the uploads behind the "single-cell features" gallery example.

MSK SPECTRUM (msk_spectrum_tme_2022; Vázquez-García, Uhlitz et al., Nature 2022) profiled 41 of the
study's 42 patients by scRNA-seq at several anatomical sites each. The cell annotations are public on
CELLxGENE (collection 4796c91c-9d8f-4692-be43-347b1727f9d8). This reads only the cell metadata of its
five h5ad files — cluster labels, per-cell pathway/module scores, per-cell 6p B-allele fraction — by
HTTP range reads, and aggregates it into six custom datasets: five patient-level, one sample-level
(each cBioPortal sample matched to the scRNA-seq site of the same patient).

Scopes: unprefixed columns pool the solid sites (ascites excluded); ADX_ are adnexal sites, NADX_
solid non-adnexal sites. Immune cell types are fractions of immune cells (CD45+ and unsorted
libraries), cancer/fibroblast/endothelial cells fractions of non-immune cells (CD45- and unsorted),
so the flow sorting does not set the composition.

Run: uv run scripts/gen-spectrum-sc-demo.py [--cache DIR]
"""
import argparse, collections, json, re
from pathlib import Path

import fsspec, h5py, numpy as np, pandas as pd, requests

STUDY = "msk_spectrum_tme_2022"
PORTAL = "https://www.cbioportal.org/api/studies/" + STUDY
CELLXGENE = "https://datasets.cellxgene.cziscience.com/"
MIN_CELLS = 50   # cells in a fraction's denominator
MIN_SCORE = 20   # cells behind a mean score
MIN_BAF = 20     # cancer cells with a 6p BAF behind a 6p call
BC_MIN = 100     # cells a site needs to enter the between-site Bray-Curtis

COMMON = ["sample", "patient_id", "author_tumor_supersite", "author_tumor_site", "author_tumor_subsite",
          "author_sort_parameters", "author_cell_type"]
FILES = {
    "all": ("f8f7f2b0-b8a5-4087-8048-8d3f5b6a49dd.h5ad", []),
    "tnk": ("1818d826-ae96-4890-8d32-8f4cbeb98d57.h5ad",
            ["cluster_label", "cluster_label_sub", "CD8.Naive.module", "CD8.Cytotoxic.module",
             "CD8.Predysfunctional.module", "CD8.Dysfunctional.module", "JAK.STAT.pathway",
             "TGFb.pathway", "ISG.module"]),
    "epi": ("c9e5378d-a8b6-4cb9-bbc5-63de145b1e2e.h5ad",
            ["cluster_label", "JAK.STAT.pathway", "TGFb.pathway", "TNFa.pathway", "NFkB.pathway",
             "Hypoxia.pathway", "EGFR.pathway", "MAPK.pathway", "PI3K.pathway", "VEGF.pathway",
             "p53.pathway", "WNT.pathway", "ISG.module", "IFNg.signaling.module", "BAF_6p"]),
    "mac": ("5e8621dd-74ba-492c-a717-015241c41588.h5ad", ["cluster_label", "JAK.STAT.pathway"]),
    "dc": ("7106ee6e-02fd-476f-b56d-a6eb5494f6da.h5ad", ["cluster_label", "Interferon.regulators.module"]),
}
# the all-cells file names two of the common columns differently
ALIAS = {"sample": "author_sample_id", "patient_id": "donor_id"}


def read_obs(key, cache):
    path = cache / f"obs_{key}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    fname, cols = FILES[key]
    fs = fsspec.filesystem("http", block_size=8 * 2**20)
    with fs.open(CELLXGENE + fname, "rb") as f, h5py.File(f, "r") as h:
        obs = h["obs"]
        def column(name):
            o = obs[name if name in obs else ALIAS[name]]
            if isinstance(o, h5py.Group):
                cats = np.array([c.decode() if isinstance(c, bytes) else str(c) for c in o["categories"][:]], dtype=object)
                codes = o["codes"][:]
                return np.where(codes >= 0, cats[np.clip(codes, 0, None)], None)
            return o[:]
        df = pd.DataFrame({c: column(c) for c in COMMON + cols})
    df.to_pickle(path)
    return df


def prepare(df):
    m = df["sample"].str.extract(r"^(SPECTRUM-OV-\d+)_S1_(CD45P|CD45N|UNSORTED)_(.+)$")
    df["pid"], df["sort"], df["site"] = m[0], m[1], m[2]
    df["unit"] = df["pid"] + "|" + df["site"]
    df["adnexa"] = df["author_tumor_supersite"] == "Adnexa"
    df["ascites"] = df["author_tumor_supersite"] == "Ascites"
    return df


def col(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def norm(s):
    return col(str(s)).upper()
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--cache", default=str(Path.home() / ".cache" / "spectrum-sc"), help="where the extracted cell metadata is kept")
args = parser.parse_args()
cache = Path(args.cache)
cache.mkdir(parents=True, exist_ok=True)
ALL, TNK, EPI, MAC, DC = (prepare(read_obs(k, cache).astype(object)) for k in ["all", "tnk", "epi", "mac", "dc"])
for d in (ALL, TNK, EPI, MAC, DC):
    for c in d.columns:
        if c.endswith(("pathway", "module")):
            d[c] = d[c].astype(float)
    if "BAF_6p" in d:
        # stored as float32 on a 0.01-ish grid: round so 0.35 compares as 0.35 at the paper's cut-offs
        d["BAF_6p"] = d["BAF_6p"].astype(float).round(4)

IMMUNE = {"T.cell": "T", "B.cell": "B", "Plasma.cell": "PLASMA", "Monocyte": "MYELOID", "Dendritic.cell": "DC", "Mast.cell": "MAST"}
NONIMM = {"Ovarian.cancer.cell": "CANCER", "Fibroblast": "FIBRO", "Endothelial.cell": "ENDO"}
TNK_COARSE = sorted(TNK.cluster_label.dropna().unique())
TNK_FINE = sorted(TNK.cluster_label_sub.dropna().unique())
MAC_L = sorted(MAC.cluster_label.dropna().unique())
DC_L = [x for x in sorted(DC.cluster_label.dropna().unique()) if x != "Mast.cell"]
CANCER_L = [x for x in sorted(EPI.cluster_label.dropna().unique()) if "ancer" in x]
CA_PATH = {"JAK.STAT.pathway": "JAKSTAT", "TGFb.pathway": "TGFB", "TNFa.pathway": "TNFA", "NFkB.pathway": "NFKB",
           "Hypoxia.pathway": "HYPOXIA", "EGFR.pathway": "EGFR", "MAPK.pathway": "MAPK", "PI3K.pathway": "PI3K",
           "VEGF.pathway": "VEGF", "p53.pathway": "P53", "WNT.pathway": "WNT", "ISG.module": "ISG",
           "IFNg.signaling.module": "IFNG"}
CD8_MOD = {"CD8.Naive.module": "NAIVE", "CD8.Cytotoxic.module": "CYTOTOXIC",
           "CD8.Predysfunctional.module": "PREDYSFUNC", "CD8.Dysfunctional.module": "DYSFUNC"}

def fractions(df, key, labels, prefix, by):
    n = df.groupby(by).size()
    c = df.groupby([by, key]).size().unstack(fill_value=0).reindex(columns=labels, fill_value=0)
    f = c.div(n, axis=0).where(n >= MIN_CELLS)
    f.columns = [prefix + col(l) for l in labels]
    return f, n

def means(df, cols, prefix, by):
    g = df.groupby(by)
    m = g[list(cols)].mean().where(g.size() >= MIN_SCORE, axis=0)
    m.columns = [prefix + cols[c] for c in cols]
    return m

def shannon(df, key, by):
    def h(s):
        p = s.value_counts(normalize=True).values
        return float(-(p * np.log(p)).sum()) if len(s) >= MIN_CELLS else np.nan
    return df.groupby(by)[key].apply(h)

def six_p(epi_cancer, by):
    b = epi_cancer.dropna(subset=["BAF_6p"])
    g = b.groupby(by)["BAF_6p"]
    n = g.size()
    loh = g.apply(lambda s: 100 * (s < 0.15).mean()).where(n >= MIN_BAF)
    imb = g.apply(lambda s: 100 * ((s >= 0.15) & (s < 0.35)).mean()).where(n >= MIN_BAF)
    status = loh.map(lambda v: np.nan if pd.isna(v) else "Heterozygous" if v <= 20 else "Subclonal LOH" if v <= 80 else "Clonal LOH")
    return loh, imb, status

def summarize(sel, by):
    """All metrics for cells passing `sel` (a function of a frame -> mask), grouped by column `by`."""
    a, t, e, m, d = (x[sel(x)] for x in (ALL, TNK, EPI, MAC, DC))
    out = {}
    imm = a[a["sort"].isin(["CD45P", "UNSORTED"]) & a.author_cell_type.isin(list(IMMUNE))]
    non = a[a["sort"].isin(["CD45N", "UNSORTED"]) & a.author_cell_type.isin(list(NONIMM))]
    fi, ni = fractions(imm, "author_cell_type", list(IMMUNE), "", by); fi.columns = ["IMM_" + IMMUNE[k] for k in IMMUNE]
    fn, nn = fractions(non, "author_cell_type", list(NONIMM), "", by); fn.columns = ["STR_" + NONIMM[k] for k in NONIMM]
    out["broad"] = pd.concat([fi, fn], axis=1)
    out["n"] = pd.DataFrame({"N_IMMUNE": ni, "N_NONIMMUNE": nn, "N_CELLS": a.groupby(by).size(),
                             "N_SITES": a.groupby(by)["unit"].nunique()})
    tc, nt = fractions(t, "cluster_label", TNK_COARSE, "TNK_", by)
    tf, _ = fractions(t, "cluster_label_sub", TNK_FINE, "TF_", by)
    sub = t.cluster_label_sub.fillna("")
    groups = pd.DataFrame({
        "TNK_NAIVE_CM": sub.str.contains("naive.centr.mem", regex=False),
        "TNK_DYSFUNC": sub.str.contains("dysfunc", regex=False),
        "TNK_TREG": sub.str.startswith("CD4.T.reg"),
    })
    gfr = groups.groupby(t[by]).mean().where(nt >= MIN_CELLS, axis=0)
    cd8 = t[t.cluster_label.fillna("").str.startswith("CD8")]
    n8 = cd8.groupby(by).size()
    gfr["CD8_DYSFUNC_OF_CD8"] = cd8.cluster_label_sub.str.contains("dysfunc", regex=False).groupby(cd8[by]).mean().where(n8 >= MIN_CELLS)
    out["tnk"] = pd.concat([tc, gfr], axis=1)
    out["tnk_fine"] = tf
    out["tnk_scores"] = pd.concat([means(cd8, CD8_MOD, "CD8_SCORE_", by),
                                   means(t, {"JAK.STAT.pathway": "JAKSTAT", "TGFb.pathway": "TGFB", "ISG.module": "ISG"}, "TNK_", by)], axis=1)
    out["n_tnk"] = nt
    fm, nm = fractions(m, "cluster_label", MAC_L, "MAC_", by)
    dd = d[d.cluster_label.isin(DC_L)]
    fd, _ = fractions(dd, "cluster_label", DC_L, "DC_", by)
    out["myeloid"] = pd.concat([fm, fd], axis=1)
    out["myeloid_scores"] = pd.concat([means(m, {"JAK.STAT.pathway": "JAKSTAT"}, "MAC_SCORE_", by),
                                       means(dd, {"Interferon.regulators.module": "IFN_REGULATORS"}, "DC_SCORE_", by)], axis=1)
    ca = e[e.cluster_label.isin(CANCER_L)]
    fc, nc = fractions(ca, "cluster_label", CANCER_L, "CC_", by)
    ne = e.groupby(by).size()
    fc["EPI_CILIATED"] = e.cluster_label.fillna("").str.startswith("Ciliated").groupby(e[by]).mean().where(ne >= MIN_CELLS)
    out["cancer"] = fc
    out["cancer_scores"] = means(ca, CA_PATH, "CA_", by)
    loh, imb, status = six_p(ca, by)
    out["six_p"] = pd.DataFrame({"CA_6P_LOH_PCT": loh, "CA_6P_IMBALANCED_PCT": imb, "CA_6P_STATUS": status})
    out["entropy"] = pd.DataFrame({"SHANNON_TNK": shannon(t, "cluster_label_sub", by),
                                   "SHANNON_MAC": shannon(m, "cluster_label", by),
                                   "SHANNON_CANCER": shannon(ca, "cluster_label", by)})
    out["N_CANCER"] = nc
    return out, (t, m, ca)

def between_site_bc(df, key, labels):
    """Mean pairwise Bray-Curtis dissimilarity of state composition between a patient's solid sites."""
    res = {}
    for pid, g in df.groupby("pid"):
        comp = g.groupby(["unit", key]).size().unstack(fill_value=0).reindex(columns=labels, fill_value=0)
        comp = comp[comp.sum(axis=1) >= BC_MIN]
        p = comp.div(comp.sum(axis=1), axis=0).values
        if len(p) < 2: continue
        ds = [np.abs(p[i] - p[j]).sum() / 2 for i in range(len(p)) for j in range(i + 1, len(p))]
        res[pid] = float(np.mean(ds))
    return pd.Series(res)

# ---- patient level: solid sites pooled (ascites excluded), and adnexa / non-adnexa solid sites
solid = lambda x: ~x.ascites
P, (t_solid, m_solid, ca_solid) = summarize(solid, "pid")
A, _ = summarize(lambda x: x.adnexa, "pid")
N, _ = summarize(lambda x: ~x.ascites & ~x.adnexa, "pid")
def scoped(name, cols=None):
    frames = []
    for pref, S in (("", P), ("ADX_", A), ("NADX_", N)):
        f = S[name] if cols is None else S[name][cols]
        frames.append(f.add_prefix(pref))
    return pd.concat(frames, axis=1)

asc_sites = ALL[ALL.ascites].groupby("pid").size()
datasets = {}
datasets["spectrum-sc-composition"] = ("SPECTRUM scRNA: cell-type composition", pd.concat([
    scoped("broad"), P["n"], pd.DataFrame({"HAS_ASCITES_SCRNA": asc_sites.reindex(P["n"].index).notna().map({True: "Yes", False: "No"})})], axis=1))
datasets["spectrum-sc-tnk"] = ("SPECTRUM scRNA: T/NK cell states", pd.concat([
    scoped("tnk"), P["tnk_scores"], P["entropy"][["SHANNON_TNK"]],
    pd.DataFrame({"BC_TNK_BETWEEN_SITES": between_site_bc(t_solid, "cluster_label_sub", TNK_FINE), "N_TNK": P["n_tnk"]})], axis=1))
datasets["spectrum-sc-tnk-fine"] = ("SPECTRUM scRNA: T/NK fine states (41)", P["tnk_fine"])
datasets["spectrum-sc-myeloid"] = ("SPECTRUM scRNA: macrophage & DC states", pd.concat([
    scoped("myeloid"), P["myeloid_scores"], P["entropy"][["SHANNON_MAC"]],
    pd.DataFrame({"BC_MAC_BETWEEN_SITES": between_site_bc(m_solid, "cluster_label", MAC_L)})], axis=1))
datasets["spectrum-sc-cancer"] = ("SPECTRUM scRNA: cancer cell states, signalling & 6p LOH", pd.concat([
    P["cancer"], P["cancer_scores"], P["six_p"],
    A["cancer_scores"][["CA_JAKSTAT", "CA_TGFB"]].add_prefix("ADX_"), N["cancer_scores"][["CA_JAKSTAT", "CA_TGFB"]].add_prefix("NADX_"),
    A["six_p"][["CA_6P_LOH_PCT", "CA_6P_STATUS"]].add_prefix("ADX_"), N["six_p"][["CA_6P_LOH_PCT", "CA_6P_STATUS"]].add_prefix("NADX_"),
    P["entropy"][["SHANNON_CANCER"]],
    pd.DataFrame({"BC_CANCER_BETWEEN_SITES": between_site_bc(ca_solid, "cluster_label", CANCER_L), "N_CANCER": P["N_CANCER"]})], axis=1))

# ---- sample level: each cBioPortal sample matched to the scRNA site of the same patient
U, _ = summarize(lambda x: x.pid.notna(), "unit")
def site_table(U):
    return pd.concat([U["broad"], U["n"][["N_IMMUNE", "N_NONIMMUNE"]], U["tnk"], U["tnk_scores"][["CD8_SCORE_DYSFUNC", "TNK_JAKSTAT"]],
                      U["myeloid"], U["cancer"].drop(columns=["EPI_CILIATED"]),
                      U["cancer_scores"][["CA_JAKSTAT", "CA_TGFB", "CA_TNFA", "CA_NFKB", "CA_HYPOXIA", "CA_ISG"]],
                      U["six_p"][["CA_6P_LOH_PCT", "CA_6P_STATUS"]]], axis=1)
site_tab = site_table(U)

pclin = requests.get(PORTAL + "/clinical-data?clinicalDataType=PATIENT", timeout=60).json()
spec2p = {x["value"]: x["patientId"] for x in pclin if x["clinicalAttributeId"] == "PATIENT_DISPLAY_NAME"}
sclin = requests.get(PORTAL + "/clinical-data?clinicalDataType=SAMPLE", timeout=60).json()
samples = collections.defaultdict(dict)
for x in sclin: samples[(x["patientId"], x["sampleId"])][x["clinicalAttributeId"]] = x["value"]
p2spec = {v: k for k, v in spec2p.items()}
units = ALL.drop_duplicates("unit")[["unit", "pid", "site", "author_tumor_site", "author_tumor_subsite"]]
rows, match_log = [], []
for (pat, sid), attrs in sorted(samples.items()):
    spec = p2spec.get(pat)
    u = units[units.pid == spec]
    sub, site = norm(attrs.get("TUMOR_SUBSITE", "")), attrs.get("TUMOR_SITE_SAMPLE", "")
    hit = u[(u.site == sub) | (u.author_tumor_subsite.map(norm) == sub)]
    how = "same subsite"
    if hit.empty:
        hit = u[u.author_tumor_site == site]
        how = "same site"
    if hit.empty:
        match_log.append((sid, spec, attrs.get("TUMOR_SUBSITE"), site, "no scRNA site", "")); continue
    if len(hit) > 1:
        how += f" ({len(hit)} scRNA sites pooled)"
        pooled = list(hit.unit)
        S, _ = summarize(lambda x: x.unit.isin(pooled), "pid")
        vals = site_table(S).loc[spec]
    else:
        vals = site_tab.loc[hit.unit.iloc[0]]
    unit = spec + "|" + "+".join(hit.site)
    match_log.append((sid, spec, attrs.get("TUMOR_SUBSITE"), site, how, unit))
    rows.append((pat, sid, unit, how, vals))
sample_df = pd.DataFrame([r[4] for r in rows], index=pd.MultiIndex.from_tuples([(r[0], r[1]) for r in rows]))
sample_df.insert(0, "SCRNA_SITE", [r[2].split("|")[1] for r in rows])
sample_df.insert(1, "SCRNA_MATCH", [r[3] for r in rows])
datasets["spectrum-sc-site"] = ("SPECTRUM scRNA: site-matched sample features", sample_df)

# ---- write lib/spectrum-sc-demo.ts


def fmt(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return ""
    if isinstance(v, (float, np.floating)):
        return f"{v:.4g}"
    return str(v)


blocks, summary = [], []
for slug, (name, df) in datasets.items():
    level = "sample" if slug == "spectrum-sc-site" else "patient"
    if level == "patient":
        df = df[df.index.isin(list(spec2p))]
        df.index = [spec2p[i] for i in df.index]
    assert len(df.columns) <= 64, (slug, len(df.columns))
    columns = [{"name": c, "datatype": "NUMBER" if pd.api.types.is_numeric_dtype(df[c].infer_objects()) else "STRING"} for c in df.columns]
    rows = []
    for idx, r in df.iterrows():
        vals = [fmt(v) for v in r.values]
        rows.append({"study": STUDY, "patient": idx[0], "sample": idx[1], "values": vals} if level == "sample"
                    else {"study": STUDY, "patient": idx, "values": vals})
    head = json.dumps({"id": slug, "name": name + " (demo)", "level": level, "columns": columns}, ensure_ascii=False)[:-1]
    blocks.append("  " + head + ', "rows": [\n' + ",\n".join("    " + json.dumps(x, ensure_ascii=False) for x in rows) + "\n  ] }")
    summary.append(f"{slug} ({level}, {len(rows)} rows, {len(columns)} columns)")

matched = collections.Counter(m[4].split(" (")[0] for m in match_log)
out = (f"// GENERATED by scripts/gen-spectrum-sc-demo.py — do not edit. MSK SPECTRUM scRNA-seq cell metadata\n"
       f"// (CELLxGENE collection 4796c91c-9d8f-4692-be43-347b1727f9d8) aggregated per patient and per sample:\n"
       + "".join(f"// {x}\n" for x in summary)
       + f"// Sample matching: {', '.join(f'{k} {n}' for k, n in matched.most_common())}.\n"
       'import type { CustomDataset } from "./custom-data-names.ts";\n\n'
       "export const SPECTRUM_SC_DEMO: CustomDataset[] = [\n" + ",\n".join(blocks) + "\n];\n")
root = Path(__file__).resolve().parent.parent
(root / "lib" / "spectrum-sc-demo.ts").write_text(out)
print("wrote lib/spectrum-sc-demo.ts:", "; ".join(summary))
