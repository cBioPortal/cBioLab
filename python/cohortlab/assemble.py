"""Rows -> contract. A line-for-line port of lib/oncoprint-assemble.ts.

The TypeScript function is the reference; test/oncoprint-conformance checks that both
produce the same JSON for the same rows. Keep the two in step.
"""
from __future__ import annotations

import math
import re
from functools import cmp_to_key
from typing import Any, Callable

import numpy as np

from .contract import BITS, DEFAULT_DISPLAY, NOT_PROFILED, Contract, Track
from .gene_tracks import normalize_gene_tracks
from .style import STYLE, assay_scale, encode_numeric, natural_ranks, natural_vector, staircase_options, staircase_rank


def _round(x: float) -> int:
    """JavaScript Math.round: halves go toward +infinity."""
    return int(math.floor(x + 0.5))


# a mutation type's class as the portal's getSimplifiedMutationType reads it (lib/oql-match.ts PORTAL_TYPE_CLASS)
_PORTAL_TYPE_CLASS = {
    "missense": ("missense_mutation", "missense", "missense_variant"),
    "frameshift": ("frame_shift_ins", "frame_shift_del", "frameshift", "frameshift_deletion", "frameshift_insertion",
                   "de_novo_start_outofframe", "frameshift_variant"),
    "nonsense": ("nonsense_mutation", "nonsense", "stopgain_snv"),
    "splice": ("splice_site", "splice", "splice site", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel",
               "splice_region"),
    "nonstart": ("translation_start_site", "start_codon_snp", "start_codon_del"),
    "nonstop": ("nonstop_mutation",),
    "inframe": ("in_frame_del", "in_frame_ins", "in_frame_deletion", "in_frame_insertion", "indel", "nonframeshift_deletion",
                "nonframeshift", "nonframeshift insertion", "nonframeshift_insertion"),
}
_CLASS_OF = {t: cls for cls, types in _PORTAL_TYPE_CLASS.items() for t in types}


def mut_class_bit(mt: str | None, mv: str | None = None) -> int:
    """A mutation's glyph class, as the TypeScript mutClassBit (the portal's getOncoprintMutationType)."""
    t = (mt or "").lower()
    if t != "fusion" and (mv or "").lower() == "promoter":
        return BITS["PROMOTER"]
    cls = "none" if t == "fusion" else _CLASS_OF.get(t, "other")
    return {"missense": BITS["MISSENSE"], "inframe": BITS["INFRAME"], "splice": BITS["SPLICE"],
            "other": BITS["OTHER_MUT"]}.get(cls, BITS["TRUNCATING"])


_DECIMAL = re.compile(r"^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$")


def _finite_number(s: str) -> float:
    """lib/sql-number.ts finiteNumber: a number only when the whole text is a decimal one, else NaN."""
    return float(s) if _DECIMAL.match(s) else math.nan


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
                      unit: str = "patient", hide_tracks: list[str] | None = None,
                      case_list_rank: dict[str, int] | None = None) -> Contract:
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
    # A call on a cell no panel covers (off-panel) is not drawn: the cell stays NOT_PROFILED and the
    # gene's % does not count it, as cBioPortal's results view does. A merged row is profiled where any
    # member is, so it can still draw a call its gene's own row leaves out. Every call left out of a
    # row is counted, so the caption says so.
    # A germline mutation is dropped like a VUS when the settings hide germline, and otherwise marks
    # its cell GERMLINE when the mutation the cell shows (class drawn, at its driver call) is germline.
    hide_vus = bool((display or {}).get("hideVUS"))
    hide_germ = bool((display or {}).get("hideGermline"))
    hidden_vus = 0
    hidden_germ = 0
    off_panel = 0
    vus_mut: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    cna_calls: dict[int, tuple[np.ndarray, np.ndarray]] = {}  # per cell: driver amp, VUS amp, driver deep deletion, VUS deep deletion
    germ_drv: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    germ_vus: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for r in events:
        i = pid_index.get(r["pid"])
        if i is None:
            continue
        rows = rows_of_gene.get(r["gene"])
        if not rows:
            continue
        bit = 0
        if r["vt"] == "mutation":
            bit = mut_class_bit(r.get("mt"), r.get("mv"))
        elif r["vt"] == "structural_variant":
            bit = BITS["SV"]
        elif r["vt"] == "cna":
            cna = float(r.get("cna") or 0)
            bit = BITS["AMP"] if cna >= 2 else (BITS["HOMDEL"] if cna <= -2 else 0)
        if not bit:
            continue
        covered = [cells for cells in rows if cells[i] != NOT_PROFILED]
        if len(covered) < len(rows):
            off_panel += 1
        if not covered:
            continue
        mut = r["vt"] == "mutation"
        germ = mut and bool(r.get("germ"))
        if germ and hide_germ:
            hidden_germ += 1
            continue
        driver = is_driver(r)
        if hide_vus and not driver:
            hidden_vus += 1
            continue
        if germ:
            for cells in covered:
                (germ_drv if driver else germ_vus).setdefault(id(cells), (cells, np.zeros(len(cells), dtype=np.uint16)))[1][i] |= bit
        if mut and not driver:
            # a VUS mutation's class joins the cell only where no driver mutation does (the portal's precedence)
            for cells in covered:
                held = vus_mut.setdefault(id(cells), (cells, np.zeros(len(cells), dtype=np.uint16)))[1]
                held[i] |= bit
            continue
        if r["vt"] == "cna":
            for cells in covered:
                calls = cna_calls.setdefault(id(cells), (cells, np.zeros((len(cells), 4), dtype=np.int32)))[1]
                calls[i, (0 if bit == BITS["AMP"] else 2) + (0 if driver else 1)] += 1
            continue
        if driver:
            bit |= BITS["DRIVER"] | (BITS["MUT_DRIVER"] if mut else BITS["SV_DRIVER"])
        for cells in covered:
            cells[i] = int(cells[i]) | bit
    # a cell's copy number: its kind with the most calls, ties a driver first, then amplification
    # (lib/oncoprint-assemble.ts); a losing driver call still makes the column driver-altered
    cna_keys = [BITS["AMP"] | BITS["CNA_DRIVER"], BITS["AMP"], BITS["HOMDEL"] | BITS["CNA_DRIVER"], BITS["HOMDEL"]]
    tie = [0, 2, 1, 3]
    for cells, calls in cna_calls.values():
        for i in np.nonzero(calls.sum(axis=1))[0]:
            best = max(range(4), key=lambda k: (calls[i, k], -tie[k]))
            any_driver = calls[i, 0] + calls[i, 2] > 0
            cells[i] = int(cells[i]) | cna_keys[best] | (BITS["DRIVER"] if any_driver else 0)
    for cells, held in vus_mut.values():
        free = (held > 0) & ((cells & BITS["MUT_DRIVER"]) == 0)
        cells[free] |= held[free].astype(cells.dtype)
    for key in set(germ_drv) | set(germ_vus):
        cells = (germ_drv.get(key) or germ_vus[key])[0]
        drv = germ_drv[key][1] if key in germ_drv else np.zeros(len(cells), dtype=np.uint16)
        vus = germ_vus[key][1] if key in germ_vus else np.zeros(len(cells), dtype=np.uint16)
        shown = np.zeros(len(cells), dtype=np.int64)
        for m in STYLE["glyph"]["mutation"]["priority"]:
            b = BITS[m["bit"]]
            shown = np.where((shown == 0) & (cells > 0) & ((cells & b) != 0), b, shown)
        germ = np.where((cells & BITS["MUT_DRIVER"]) != 0, drv, vus).astype(np.int64)
        cells[(shown > 0) & ((germ & shown) != 0)] |= BITS["GERMLINE"]

    # ---- clinical tracks -------------------------------------------------
    clin: list[Track] = []
    # the automatic rows the reader switched off (lib/profile-names.ts AUTO_TRACKS); this port draws only Study of origin
    if multi and "Study of origin" not in (hide_tracks or []):
        cat_idx = {s: i for i, s in enumerate(studies)}
        cells = np.full(n, -1, dtype=np.int32)
        for i, p in enumerate(all_pids):
            s = study_of.get(p)
            if s is not None:
                cells[i] = cat_idx[s]
        clin.append(Track("clinical", "Study of origin", cells, {"categories": list(studies)}))
    for c in clinical:
        attr, val_by_pid = c["attr"], c["values"]
        named = {"name": c["name"]} if c.get("name") and c["name"] != attr else {}
        if attr == "MUTATION_SPECTRUM":
            # each column's six substitution counts ("a,b,c,d,e,f"); a column with none is no data
            k = len(STYLE["glyph"]["spectrum"]["categories"])
            cells = np.full(n, -1, dtype=np.int32)
            stacked = [0.0] * (n * k)
            for i, p in enumerate(all_pids):
                v = val_by_pid.get(p)
                if not v:
                    continue
                counts = [float(x) for x in v.split(",")]
                if len(counts) != k or not any(x > 0 for x in counts):
                    continue
                stacked[i * k:(i + 1) * k] = counts
                cells[i] = i
            clin.append(Track("clinical", attr, cells, {**named, "stack": list(STYLE["glyph"]["spectrum"]["categories"]), "values": stacked}))
            continue
        present = [val_by_pid[p] for p in all_pids if p in val_by_pid]
        nums = [x for x in (_finite_number(v) for v in present) if math.isfinite(x)]
        # a NUMBER is bars, any other declared datatype categories (the portal's OncoprintUtils
        # 1421-1470); an undeclared attribute is bars when 90% of its values parse and >10 differ
        declared = str(c["datatype"]).upper() if c.get("datatype") else None
        if not present or (declared == "NUMBER" and not nums):
            clin.append(Track("clinical", attr + " (no data)", np.full(n, -1, dtype=np.int32), {"categories": []}))
            continue
        if declared == "NUMBER" if declared else len(nums) >= 0.9 * len(present) and len(set(nums)) > 10:
            # bars over the data's range, as the portal draws them: its fixed range for a fraction of
            # the genome, its log scale for mutation counts
            lo, hi = min(nums), max(nums)
            if attr == "FRACTION_GENOME_ALTERED":
                lo, hi = min(lo, 0), max(hi, 1)
            log_scale = attr == "MUTATION_COUNT" and lo >= 0
            cells = np.full(n, -1, dtype=np.int32)
            values = np.full(n, np.nan, dtype=np.float32)
            for i, p in enumerate(all_pids):
                if p in val_by_pid:
                    x = _finite_number(val_by_pid[p])
                    if math.isfinite(x):
                        cells[i] = encode_numeric(x, lo, hi, log_scale)
                        values[i] = x
            clin.append(Track("clinical", attr, cells, {**named, "numeric": True, "bar": True, **({"logScale": True} if log_scale else {}), "min": _num(lo), "max": _num(hi),
                                                        "values": values}))
            continue
        counts: dict[str, int] = {}
        for p in all_pids:
            v = val_by_pid.get(p)
            if v is not None:
                counts[v] = counts.get(v, 0) + 1
        categories = [k for k, _ in sorted(counts.items(), key=lambda e: -e[1])]
        cat_idx = {c_: i for i, c_ in enumerate(categories)}
        cells = np.full(n, -1, dtype=np.int32)
        for i, p in enumerate(all_pids):
            v = val_by_pid.get(p)
            if v is not None:
                cells[i] = cat_idx[v]
        clin.append(Track("clinical", attr, cells, {**named, "categories": categories}))

    # ---- heatmap tracks ----------------------------------------------------
    heat: list[Track] = []
    for h in heatmap:
        assay = assay_scale(list(h["values"].values()), h.get("pivot"), h.get("sortOrder")) if h.get("assay") else None
        for gene in h["genes"]:
            label = _heatmap_label(gene, h["profileType"])
            ref = z_reference.get(h["profileType"] + "|" + gene)
            using_ref = bool(ref and ref["sd"] > 0)
            # called on the next line, within this iteration
            tx = (lambda v: (v - ref["mean"]) / ref["sd"]) if using_ref else (lambda v: v)  # noqa: B023
            vals = [tx(h["values"][p + "|" + gene]) for p in all_pids if (p + "|" + gene) in h["values"]]
            if not vals:
                heat.append(Track("clinical", label + " (no data)", np.full(n, -1, dtype=np.int32), {"categories": []}))
                continue
            # the portal's fixed ranges and colours: VAF and methylation 0..1, other profiles -3..3
            ramp = None if h.get("assay") else "vaf" if h.get("isVaf") else "methylation" if re.search("methylation", h["profileType"], re.I) else "expression"
            if assay:
                lo, hi, center = assay["min"], assay["max"], None
            elif ramp in ("vaf", "methylation"):
                lo, hi, center = 0.0, 1.0, None
            else:
                lo, hi, center = -3.0, 3.0, 0.0
            span = (hi - lo) or 1
            cells = np.full(n, -1, dtype=np.int32)
            values = np.full(n, np.nan, dtype=np.float32)
            for i, p in enumerate(all_pids):
                k = p + "|" + gene
                if k in h["values"]:
                    cells[i] = _round(255 * (max(lo, min(hi, tx(h["values"][k]))) - lo) / span)
                    values[i] = tx(h["values"][k])
            if using_ref:
                nst = len(ref["studies"])
                note = ("z-scored against " + f"{ref['n']:,}" + " patients pooled from " + str(nst) + " stud" + ("y" if nst == 1 else "ies") +
                        " (" + ", ".join(ref["studies"]) + ") — the reference is federated even where the columns are not")
            elif h.get("isVaf"):
                note = "allele fraction, max across a patient's mutations in the gene"
            else:
                note = "a patient's: its samples' value furthest from 0"
            heat.append(Track("heatmap", label, cells, {"numeric": True, **({"ramp": ramp} if ramp else {}), "gene": gene, "profileType": h["profileType"],
                                                        **({"profileKind": h["profileKind"]} if h.get("profileKind") else {"profileKind": "MUTATION_EXTENDED VAF"} if h.get("isVaf") else {}),
                                                        "note": note,
                                                        # an assay's range is exact: its colour stops sit on it
                                                        "min": _num(lo if assay else _round(lo * 100) / 100), "max": _num(hi if assay else _round(hi * 100) / 100),
                                                        "center": None if center is None else _round(255 * (0 - lo) / span), "values": values,
                                                        **({"stops": assay["stops"], "colors": assay["colors"]} if assay else {})}))

    # ---- derived-event tracks ---------------------------------------------
    dev: list[Track] = []
    for de in derived:
        pids = set(de["pids"])
        cells = np.fromiter((1 if p in pids else 0 for p in all_pids), dtype=np.int32, count=n)
        dev.append(Track("derivedEvent", str(de.get("label") or "derived event")[:60], cells, {}))

    # ---- column sort within groups ------------------------------------------
    # the portal's staircase: each gene row's staircase_rank, not profiled as unaltered; then, after
    # every row, the first row's not profiled last; then the natural case id
    switches = staircase_options(display or {})
    unaltered = staircase_rank(0, switches)
    gene_ranks = [[unaltered if int(c) == NOT_PROFILED else staircase_rank(int(c), switches) for c in gene_cells[t.label]] for t in gene_tracks]
    first_row = gene_cells[gene_tracks[0].label] if gene_tracks else None
    na_sign = -1 if next((s for s in sort if s["track"] == "genomic"), {}).get("dir") == "desc" else 1

    def bare(p: str) -> str:
        st = study_of.get(p)
        return p[len(st) + 1:] if st and p.startswith(st + "_") else p

    id_key = [(natural_vector(bare(p)), p) for p in all_pids]

    def by_id(x: int, y: int) -> int:
        return -1 if id_key[x] < id_key[y] else (1 if id_key[x] > id_key[y] else 0)

    def genomic_cmp(x: int, y: int) -> int:
        for ranks in gene_ranks:
            if ranks[x] != ranks[y]:
                return ranks[x] - ranks[y]
        return 0

    sortable = {t.label: t for t in [*clin, *dev, *heat]}

    def track_cmp(t: Track, sign: int):
        cells = t.cells
        vals = t.meta.get("values")
        if vals is not None:
            def vcmp(x: int, y: int) -> int:
                a, b = float(vals[x]), float(vals[y])
                if math.isnan(a) or math.isnan(b):
                    return 0 if math.isnan(a) == math.isnan(b) else (1 if math.isnan(a) else -1)
                return sign * ((a > b) - (a < b))
            return vcmp

        # a text clinical track by naturalSort of its values (SortUtils stringClinicalComparator)
        cats = t.meta.get("categories")
        rank = natural_ranks(list(cats)) if t.kind == "clinical" and cats else None

        def cmp(x: int, y: int) -> int:
            a, b = int(cells[x]), int(cells[y])
            if a == b:
                return 0
            if a == -1:
                return 1
            if b == -1:
                return -1
            return sign * (rank[a] - rank[b] if rank else a - b)
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
        if s["track"] == "caseList":
            if case_list_rank is None:
                raise ValueError("sort: 'caseList' needs a cohort chosen by a user-defined case list (a sampleList or patientList clause in its all)")
            at = [case_list_rank.get(p) for p in all_pids]

            def case_list_cmp(x: int, y: int, sign: int = sign, at: list[int | None] = at) -> int:
                a, b = at[x], at[y]
                if a is None or b is None:
                    return 0 if a is b else (1 if a is None else -1)
                return sign * ((a > b) - (a < b))
            cmps.append(case_list_cmp)
            continue
        t = sortable.get(s["track"])
        if t is None:
            raise ValueError("sort: '" + s["track"] + "' is not a track in this oncoprint — sortable: genomic, id" +
                             (", caseList" if case_list_rank is not None else "") +
                             (", " + ", ".join(sortable) if sortable else "") + " (clinical sort keys must also be listed in clinical)")
        cmps.append(track_cmp(t, sign))
    cmps.append(genomic_cmp)

    # a tie on every key: the first track key's direction over the bare id by naturalSort
    # (SortUtils alphabeticalDefault); with no track key, the first gene row's not profiled last
    # (first under a descending genomic key), then the genetic track's stringToVector order
    first = next((s for s in sort if s["track"] in sortable), None)

    def final(x: int, y: int) -> int:
        if first_row is not None:
            na = int(first_row[x] == NOT_PROFILED) - int(first_row[y] == NOT_PROFILED)
            if na:
                return na_sign * na
        return by_id(x, y)
    if first is not None:
        natural = natural_ranks([bare(p) for p in all_pids])
        tie_sign = -1 if first.get("dir") == "desc" else 1

        def final(x: int, y: int) -> int:
            return tie_sign * (natural[x] - natural[y]) or by_id(x, y)

    def column_cmp(x: int, y: int) -> int:
        for c in cmps:
            r = c(x, y)
            if r:
                return r
        return final(x, y)

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
    # rows top to bottom in the portal's order: clinical, derived-cohort rows, genes, heatmaps
    def reordered(t: Track) -> dict[str, Any]:
        """the track's meta with its exact values in column order, float32 as the TypeScript carries them, None where absent"""
        if "values" not in t.meta:
            return t.meta
        return {**t.meta, "values": [None if math.isnan(x) else float(x) for x in t.meta["values"][order_arr]]}

    def restacked(t: Track) -> Track:
        """a stacked row moves each column's counts together, and its cells name their new positions"""
        k, v = len(t.meta["stack"]), t.meta["values"]
        cells = np.array([-1 if t.cells[i] == -1 else j for j, i in enumerate(order)], dtype=np.int32)
        return Track(t.kind, t.label, cells, {**t.meta, "values": [x for i in order for x in v[i * k:(i + 1) * k]]})

    tracks: list[Track] = [restacked(t) if t.meta.get("stack") else Track(t.kind, t.label, t.cells[order_arr], reordered(t)) for t in clin]

    def gene_counts(cells: np.ndarray) -> dict[str, Any]:
        """The pooled numbers and each group's: the same formula over a slice of the columns."""
        profiled = int((cells != NOT_PROFILED).sum())
        altered = int((cells > 0).sum())
        driver_altered = int(((cells > 0) & ((cells & BITS["DRIVER"]) != 0)).sum())
        return {"altered": altered, "profiled": profiled, "driverAltered": driver_altered,
                "freqPct": _round(1000 * altered / profiled) / 10 if profiled else None,
                "driverPct": _round(1000 * driver_altered / profiled) / 10 if profiled else None}

    for t in dev:
        cells = t.cells[order_arr]
        alt = int((cells == 1).sum())
        tracks.append(Track(t.kind, t.label, cells, {**t.meta, "altered": alt, "profiled": int(cells.size), "freqPct": _round(1000 * alt / cells.size) / 10}))
    for gt in gene_tracks:
        cells = gene_cells[gt.label][order_arr]
        by_group = [{"group": g["name"], **{k: v for k, v in gene_counts(cells[g["start"]:g["start"] + g["count"]]).items() if k != "driverAltered"}}
                    for g in ranges] if len(ranges) > 1 else None
        tracks.append(Track("gene", gt.label, cells, {
            **({"members": list(gt.members)} if len(gt.members) > 1 else {}),
            **gene_counts(cells),
            **({"byGroup": by_group} if by_group is not None else {})}))
    for t in heat:
        tracks.append(Track(t.kind, t.label, t.cells[order_arr], reordered(t)))

    return Contract(
        study=" + ".join(studies) if multi else studies[0], studies=list(studies), groups=ranges, columns=columns, tracks=tracks,
        unit=unit,
        conventions={"cna": "high-level only (±2)", "notProfiled": "distinct cell state",
                     "frequencyDenominator": "profiled samples" if unit == "sample" else "profiled patients",
                     "column": ("one sample; a cohort selects patients, so every sample of a selected patient is drawn — "
                                "including samples on which the cohort's own criterion was never measured. Patient-level "
                                "clinical values repeat across that patient's samples.") if unit == "sample" else
                               ("one patient; a patient's samples are collapsed (clinical: a patient row wins, else for a NUMBER its samples' mean, "
                                "MUTATION_COUNT their max, for anything else the value they agree on, otherwise \"Mixed\"; heatmap: the sample value furthest from 0; VAF: max)"),
                     "annotation": annotation_source, "lineGap": line_gap,
                     "sort": [("-" if s.get("dir") == "desc" else "") + s["track"] for s in sort],
                     **({"caseList": True} if case_list_rank is not None else {}),
                     **_custom_driver_report(events)},
        display=dict(display) if display else dict(DEFAULT_DISPLAY),
        stats={"nColumns": len(columns), "ms": 0, **({"hiddenVus": hidden_vus} if hide_vus else {}), **({"hiddenGermline": hidden_germ} if hide_germ else {}),
               **({"offPanel": off_panel} if off_panel else {})})


def _custom_driver_report(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Port of customDriverReport: any cbp_driver value, and the sorted cbp_driver_tiers values."""
    binary = any(e.get("df") for e in events)
    tiers = sorted({e["dt"] for e in events if e.get("dt")})
    return {"customDrivers": {"binary": binary, "tiers": tiers}} if binary or tiers else {}


def _num(x: float) -> int | float:
    """JSON-friendly number: integers print as integers, like JavaScript."""
    return int(x) if float(x).is_integer() else float(x)
