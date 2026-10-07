"""Rows -> contract. A line-for-line port of lib/oncoprint-assemble.ts.

The TypeScript function is the reference; test/oncoprint-conformance checks that both
produce the same JSON for the same rows. Keep the two in step.
"""
from __future__ import annotations

import math
import re
from functools import cmp_to_key
from typing import Any, Callable, Iterable

import numpy as np

from .contract import BITS, DEFAULT_DISPLAY, NOT_PROFILED, Contract, Track
from .gene_tracks import normalize_gene_tracks


def _round(x: float) -> int:
    """JavaScript Math.round: halves go toward +infinity."""
    return int(math.floor(x + 0.5))


def mut_class_bit(mt: str | None) -> int:
    if not mt:
        return BITS["OTHER_MUT"]
    t = mt.lower()
    if t.startswith("missense"):
        return BITS["MISSENSE"]
    if t.startswith(("nonsense", "frame_shift", "nonstop")):
        return BITS["TRUNCATING"]
    if t.startswith("in_frame"):
        return BITS["INFRAME"]
    if t.startswith("splice"):
        return BITS["SPLICE"]
    return BITS["OTHER_MUT"]


def _js_number(s: str) -> float:
    """Number(str) for the strings a clinical table holds; NaN when JS would give NaN."""
    try:
        v = s.strip()
        if v == "":
            return 0.0
        return float(v)
    except ValueError:
        return math.nan


def _heatmap_label(gene: str, profile_type: str) -> str:
    # lib/profile-names.ts: heatmapTrackLabel — kept in one place there; mirrored here for the port
    if re.fullmatch(r"vaf", profile_type, re.I):
        return gene + " VAF"
    p = profile_type.lower()
    if "zscore" in p or "z_score" in p or "z-score" in p:
        if "rna" in p or "mrna" in p:
            return gene + " mRNA-z"
        if "protein" in p or "rppa" in p or "prot" in p:
            return gene + " protein-z"
        return gene + " " + profile_type + "-z"
    if "methyl" in p:
        return gene + " methylation"
    return gene + " " + profile_type


def assemble_contract(*, genes: list[Any], groups: list[dict[str, Any]], studies: list[str], events: list[dict[str, Any]],
                      coverage: list[dict[str, Any]], is_driver: Callable[[dict[str, Any]], bool], annotation_source: str,
                      clinical: list[dict[str, Any]], heatmap: list[dict[str, Any]] | None = None, z_reference: dict[str, Any] | None = None,
                      derived: list[dict[str, Any]] | None = None, sort: list[dict[str, str]] | None = None, line_gap: int = 90,
                      study_of: dict[str, str] | None = None, display: dict[str, Any] | None = None,
                      unit: str = "patient") -> Contract:
    heatmap = heatmap or []
    derived = derived or []
    sort = sort or [{"track": "genomic", "dir": "asc"}]
    z_reference = z_reference or {}
    study_of = study_of or {}
    multi = len(studies) > 1
    all_pids: list[str] = [p for g in groups for p in g["pids"]]
    if not all_pids:
        raise ValueError("cohort is empty")
    n = len(all_pids)
    pid_index = {p: i for i, p in enumerate(all_pids)}

    # ---- gene-track cells ------------------------------------------------
    # A merged row is the bitwise OR of its members, so it is altered where any member is and
    # profiled where any member was — the union denominator, with no special case. A gene may
    # appear in several rows (merged, and again alone), so one symbol maps to a LIST of rows.
    gene_tracks, _symbols = normalize_gene_tracks(genes)
    gene_cells = {t.label: np.full(n, NOT_PROFILED, dtype=np.int32) for t in gene_tracks}
    rows_of_gene: dict[str, list[Any]] = {}
    for t in gene_tracks:
        for m in t.members:
            rows_of_gene.setdefault(m, []).append(gene_cells[t.label])
    for r in coverage:
        i = pid_index.get(r["pid"])
        if i is None:
            continue
        for g in r["genes"]:
            for cells in rows_of_gene.get(g, ()):
                if cells[i] == NOT_PROFILED:
                    cells[i] = 0
    # Hiding unknown significance drops the ALTERATION as the event is read, so a driver in one
    # gene cannot smuggle another gene's passenger onto a merged row. The column stays profiled.
    hide_vus = bool((display or {}).get("hideVUS"))
    hidden_vus = 0
    for r in events:
        i = pid_index.get(r["pid"])
        if i is None:
            continue
        rows = rows_of_gene.get(r["gene"])
        if not rows:
            continue
        bit = 0
        if r["vt"] == "mutation":
            bit = mut_class_bit(r.get("mt"))
        elif r["vt"] == "structural_variant":
            bit = BITS["SV"]
        elif r["vt"] == "cna":
            cna = float(r.get("cna") or 0)
            bit = BITS["AMP"] if cna >= 2 else (BITS["HOMDEL"] if cna <= -2 else 0)
        if not bit:
            continue
        driver = is_driver(r)
        if hide_vus and not driver:
            hidden_vus += 1
            for cells in rows:
                if cells[i] == NOT_PROFILED:
                    cells[i] = 0
            continue
        if driver:
            bit |= BITS["DRIVER"]
        for cells in rows:
            cells[i] = (0 if cells[i] == NOT_PROFILED else int(cells[i])) | bit

    # ---- clinical tracks -------------------------------------------------
    clin: list[Track] = []
    if multi:
        cat_idx = {s: i for i, s in enumerate(studies)}
        cells = np.full(n, -1, dtype=np.int32)
        for i, p in enumerate(all_pids):
            s = study_of.get(p)
            if s is not None:
                cells[i] = cat_idx[s]
        clin.append(Track("clinical", "Study", cells, {"categories": list(studies)}))
    for c in clinical:
        attr, val_by_pid = c["attr"], c["values"]
        present = [val_by_pid[p] for p in all_pids if p in val_by_pid]
        if not present:
            clin.append(Track("clinical", attr + " (no data)", np.full(n, -1, dtype=np.int32), {"categories": []}))
            continue
        nums = [x for x in (_js_number(v) for v in present) if math.isfinite(x)]
        if present and len(nums) >= 0.9 * len(present) and len(set(nums)) > 10:
            lo, hi = min(nums), max(nums)
            span = (hi - lo) or 1
            cells = np.full(n, -1, dtype=np.int32)
            for i, p in enumerate(all_pids):
                if p in val_by_pid:
                    x = _js_number(val_by_pid[p])
                    if math.isfinite(x):
                        cells[i] = _round(255 * (x - lo) / span)
            clin.append(Track("clinical", attr, cells, {"numeric": True, "min": _num(lo), "max": _num(hi)}))
            continue
        counts: dict[str, int] = {}
        for p in all_pids:
            v = val_by_pid.get(p)
            if v is not None:
                counts[v] = counts.get(v, 0) + 1
        categories = [k for k, _ in sorted(counts.items(), key=lambda e: -e[1])[:8]]
        cat_idx = {c_: i for i, c_ in enumerate(categories)}
        cells = np.full(n, -1, dtype=np.int32)
        for i, p in enumerate(all_pids):
            v = val_by_pid.get(p)
            if v is not None:
                cells[i] = cat_idx.get(v, len(categories))
        has_other = any(v not in cat_idx for v in counts)
        clin.append(Track("clinical", attr, cells, {"categories": categories + (["Other"] if has_other else [])}))

    # ---- heatmap tracks ----------------------------------------------------
    heat: list[Track] = []
    for h in heatmap:
        is_z = re.search(r"zscore", h["profileType"], re.I) is not None
        for gene in h["genes"]:
            label = _heatmap_label(gene, h["profileType"])
            ref = z_reference.get(h["profileType"] + "|" + gene)
            using_ref = bool(ref and ref["sd"] > 0)
            tx = (lambda v: (v - ref["mean"]) / ref["sd"]) if using_ref else (lambda v: v)
            vals = [tx(h["values"][p + "|" + gene]) for p in all_pids if (p + "|" + gene) in h["values"]]
            if not vals:
                heat.append(Track("clinical", label + " (no data)", np.full(n, -1, dtype=np.int32), {"categories": []}))
                continue
            if h.get("isVaf"):
                lo, hi, center = 0.0, 1.0, None
            elif is_z or using_ref:
                lo, hi, center = -3.0, 3.0, 0.0
            else:
                d_min, d_max = min(vals), max(vals)
                if d_min < 0 < d_max:
                    m = max(-d_min, d_max)
                    lo, hi, center = -m, m, 0.0
                else:
                    lo, hi, center = d_min, d_max, None
            span = (hi - lo) or 1
            cells = np.full(n, -1, dtype=np.int32)
            for i, p in enumerate(all_pids):
                k = p + "|" + gene
                if k in h["values"]:
                    cells[i] = _round(255 * (max(lo, min(hi, tx(h["values"][k]))) - lo) / span)
            if using_ref:
                nst = len(ref["studies"])
                note = ("z-scored against " + f"{ref['n']:,}" + " patients pooled from " + str(nst) + " stud" + ("y" if nst == 1 else "ies") +
                        " (" + ", ".join(ref["studies"]) + ") — the reference is federated even where the columns are not")
            elif h.get("isVaf"):
                note = "allele fraction, max across a patient's mutations in the gene"
            else:
                note = "mean across a patient's samples"
            heat.append(Track("heatmap", label, cells, {"numeric": True, "gene": gene, "profileType": h["profileType"], "note": note,
                                                        "min": _num(_round(lo * 100) / 100), "max": _num(_round(hi * 100) / 100),
                                                        "center": None if center is None else _round(255 * (0 - lo) / span)}))

    # ---- derived-event tracks ---------------------------------------------
    dev: list[Track] = []
    for de in derived:
        pids = set(de["pids"])
        cells = np.fromiter((1 if p in pids else 0 for p in all_pids), dtype=np.int32, count=n)
        dev.append(Track("derivedEvent", str(de.get("label") or "derived event")[:60], cells, {}))

    # ---- column sort within groups ------------------------------------------
    def cell_rank(c: int) -> int:
        if c <= 0:
            return 0
        t = 8 if c & BITS["AMP"] else 7 if c & BITS["HOMDEL"] else 6 if c & BITS["SV"] else 5 if c & BITS["TRUNCATING"] else \
            4 if c & BITS["INFRAME"] else 3 if c & BITS["SPLICE"] else 2 if c & BITS["MISSENSE"] else 1
        return t * 2 + (1 if c & BITS["DRIVER"] else 0)

    gene_cell_list = [gene_cells[t.label] for t in gene_tracks]

    def by_id(x: int, y: int) -> int:
        return -1 if all_pids[x] < all_pids[y] else (1 if all_pids[x] > all_pids[y] else 0)

    def genomic_cmp(x: int, y: int) -> int:
        for cells in gene_cell_list:
            rx, ry = cell_rank(int(cells[x])), cell_rank(int(cells[y]))
            if rx != ry:
                return ry - rx
        return 0

    sortable = {t.label: t for t in [*clin, *dev, *heat]}

    def track_cmp(t: Track, sign: int):
        cells = t.cells

        def cmp(x: int, y: int) -> int:
            a, b = int(cells[x]), int(cells[y])
            if a == b:
                return 0
            if a == -1:
                return 1
            if b == -1:
                return -1
            return sign * (a - b)
        return cmp

    cmps = []
    for s in sort:
        sign = -1 if s.get("dir") == "desc" else 1
        if s["track"] == "genomic":
            cmps.append(lambda x, y, sign=sign: sign * genomic_cmp(x, y))
            continue
        if s["track"] == "id":
            cmps.append(lambda x, y, sign=sign: sign * by_id(x, y))
            continue
        t = sortable.get(s["track"])
        if t is None:
            raise ValueError("sort: '" + s["track"] + "' is not a track in this oncoprint — sortable: genomic, id" +
                             (", " + ", ".join(sortable) if sortable else "") + " (clinical sort keys must also be listed in clinical)")
        cmps.append(track_cmp(t, sign))
    cmps.append(genomic_cmp)

    def column_cmp(x: int, y: int) -> int:
        for c in cmps:
            r = c(x, y)
            if r:
                return r
        return -1 if all_pids[x] < all_pids[y] else 1

    order: list[int] = []
    ranges = []
    cursor = 0
    for g in groups:
        idxs = sorted((pid_index[p] for p in g["pids"]), key=cmp_to_key(column_cmp))
        order.extend(idxs)
        ranges.append({"name": g["name"], "start": cursor, "count": len(idxs)})
        cursor += len(idxs)
    order_arr = np.asarray(order, dtype=np.int64)
    columns = [all_pids[i] for i in order]

    # ---- track meta (panel-aware frequencies) -------------------------------
    tracks: list[Track] = []

    def gene_counts(cells: np.ndarray) -> dict[str, Any]:
        """The pooled numbers and each group's: the same formula over a slice of the columns."""
        profiled = int((cells != NOT_PROFILED).sum())
        altered = int((cells > 0).sum())
        driver_altered = int(((cells > 0) & ((cells & BITS["DRIVER"]) != 0)).sum())
        return {"altered": altered, "profiled": profiled, "driverAltered": driver_altered,
                "freqPct": _round(1000 * altered / profiled) / 10 if profiled else None,
                "driverPct": _round(1000 * driver_altered / profiled) / 10 if profiled else None}

    for gt in gene_tracks:
        cells = gene_cells[gt.label][order_arr]
        by_group = [{"group": g["name"], **{k: v for k, v in gene_counts(cells[g["start"]:g["start"] + g["count"]]).items() if k != "driverAltered"}}
                    for g in ranges] if len(ranges) > 1 else None
        tracks.append(Track("gene", gt.label, cells, {
            **({"members": list(gt.members)} if len(gt.members) > 1 else {}),
            **gene_counts(cells),
            **({"byGroup": by_group} if by_group is not None else {})}))
    for t in dev:
        cells = t.cells[order_arr]
        alt = int((cells == 1).sum())
        tracks.append(Track(t.kind, t.label, cells, {**t.meta, "altered": alt, "profiled": int(cells.size), "freqPct": _round(1000 * alt / cells.size) / 10}))
    for t in heat:
        tracks.append(Track(t.kind, t.label, t.cells[order_arr], t.meta))
    for t in clin:
        tracks.append(Track(t.kind, t.label, t.cells[order_arr], t.meta))

    return Contract(
        study=" + ".join(studies) if multi else studies[0], studies=list(studies), groups=ranges, columns=columns, tracks=tracks,
        unit=unit,
        conventions={"cna": "high-level only (±2)", "notProfiled": "distinct cell state",
                     "frequencyDenominator": "profiled samples" if unit == "sample" else "profiled patients",
                     "column": ("one sample; a cohort selects patients, so every sample of a selected patient is drawn — "
                                "including samples on which the cohort's own criterion was never measured. Patient-level "
                                "clinical values repeat across that patient's samples.") if unit == "sample" else
                               ("one patient; a patient's samples are collapsed (clinical: patient rows win, else one "
                                "sample's value; heatmap: mean across samples; VAF: max)"),
                     "annotation": annotation_source, "lineGap": line_gap,
                     "sort": [("-" if s.get("dir") == "desc" else "") + s["track"] for s in sort]},
        display=dict(display) if display else dict(DEFAULT_DISPLAY),
        stats={"nColumns": len(columns), "ms": 0, **({"hiddenVus": hidden_vus} if hide_vus else {})})


def _num(x: float) -> int | float:
    """JSON-friendly number: integers print as integers, like JavaScript."""
    return int(x) if float(x).is_integer() else float(x)
