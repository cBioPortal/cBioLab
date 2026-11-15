"""The oncoprint render contract and its OPB1 binary form.

Mirrors lib/types.ts (Contract, Track) and lib/oncoprint-binary.ts. Cells are numpy arrays,
one per track: gene tracks hold the alteration bitmask, numeric tracks 0..255, categorical
tracks a category index; -1 means not profiled / no data everywhere.
"""
from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np

from .style import BITS, STYLE, numeric_value  # the one bit definition, generated from lib/oncoprint-style.ts

DEFAULT_DISPLAY: dict[str, Any] = {"showUnaltered": True, "whitespace": True, "gaps": "none", "clinicalLegends": "all",
                                   "colorByType": True, "colorByGermline": True, "hideVUS": False, "annotate": "oncokb", "whiteBackground": False,
                                   "showOql": True}
NOT_PROFILED = -1
_MAGIC = 0x4F504231  # "OPB1"


@dataclass
class Track:
    kind: str
    label: str
    cells: np.ndarray
    meta: dict[str, Any] = field(default_factory=dict)

    def __getattr__(self, name: str) -> Any:  # freqPct, categories, min, max, center, ...
        meta = self.__dict__.get("meta") or {}
        if name in meta:
            return meta[name]
        raise AttributeError(name)

    def to_json(self) -> dict[str, Any]:
        d = {"kind": self.kind, "label": self.label, **{k: _jsnum(v) for k, v in self.meta.items()}}
        d["cells"] = [int(x) for x in self.cells]
        return d


@dataclass
class Contract:
    study: str
    studies: list[str]
    groups: list[dict[str, Any]]
    columns: list[str]
    tracks: list[Track]
    conventions: dict[str, Any]
    stats: dict[str, Any]
    unit: str = "patient"
    #: resolved viewing options (showUnaltered, whitespace, gaps, clinicalLegends, style, colors)
    display: dict[str, Any] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.columns)

    def track(self, label: str) -> Track:
        for t in self.tracks:
            if t.label == label:
                return t
        raise KeyError(label)

    def genes(self) -> list[Track]:
        return [t for t in self.tracks if t.kind == "gene"]

    def frequencies(self) -> list[dict[str, Any]]:
        """Per gene track: altered / profiled and driver / profiled, overall and per column group."""
        out = []
        for t in self.genes():
            row = {"gene": t.label, "anyPct": t.meta.get("freqPct"), "driverPct": t.meta.get("driverPct"), "profiled": t.meta.get("profiled")}
            for g in self.groups:
                c = t.cells[g["start"]: g["start"] + g["count"]]
                prof = int((c != NOT_PROFILED).sum())
                row[g["name"]] = None if not prof else round(100.0 * int((c > 0).sum()) / prof, 1)
            out.append(row)
        return out

    def to_json(self) -> dict[str, Any]:
        return {"study": self.study, "studies": self.studies, "unit": self.unit, "groups": self.groups, "columns": self.columns,
                "tracks": [t.to_json() for t in self.tracks], "conventions": self.conventions,
                "display": self.display or DEFAULT_DISPLAY, "stats": self.stats}

    @staticmethod
    def from_json(obj: dict[str, Any]) -> "Contract":
        tracks = []
        for t in obj["tracks"]:
            meta = {k: v for k, v in t.items() if k not in ("kind", "label", "cells")}
            tracks.append(Track(t["kind"], t["label"], np.asarray(t["cells"], dtype=np.int32), meta))
        return Contract(obj["study"], obj.get("studies") or [obj["study"]], obj["groups"], obj["columns"], tracks,
                        obj.get("conventions", {}), obj.get("stats", {}), obj.get("unit", "patient"), obj.get("display") or dict(DEFAULT_DISPLAY))

    # ---- tabular export (the portal's "Tabular" download, lib/oncoprint-tabular.ts) ----
    def rows(self, order: Iterable[int] | None = None) -> Iterable[list[str]]:
        """CLINICAL rows, then each gene's CNA, MUTATIONS, MRNA, PROTEIN, STRUCTURAL_VARIANT rows, then a
        group per heatmap profile kind, then DERIVED. `order`: the columns as drawn, as indices; without it
        the contract's order, less the unaltered columns when its display hides them."""
        genes = [t for t in self.tracks if t.kind == "gene"]
        if order is not None:
            idx = [int(i) for i in order]
        else:
            idx = [i for i in range(len(self.columns))
                   if self.display.get("showUnaltered", True) is not False or any(int(t.cells[i]) > 0 for t in genes)]
        annotated = (self.display.get("annotate") or "none") != "none"
        yield ["track_name", "track_type", *[self.columns[i] for i in idx]]
        for t in self.tracks:
            if t.kind != "clinical":
                continue
            name = t.meta.get("name") or t.label
            if t.meta.get("stack") and t.meta.get("values") is not None:
                st, v = t.meta["stack"], t.meta["values"]
                for j, cat in enumerate(st):
                    yield [f"{name} ({cat})", "CLINICAL", *["" if int(t.cells[i]) == -1 else _float32_text(v[int(t.cells[i]) * len(st) + j]) for i in idx]]
                continue
            yield [name, "CLINICAL", *[_clinical_text(t, i) for i in idx]]
        by_label: dict[str, list[Track]] = {}
        for t in genes:
            by_label.setdefault(t.label, []).append(t)
        for group in GENETIC_GROUPS:
            for label, ts in by_label.items():
                vals = []
                for i in idx:
                    texts: list[str] = []
                    for t in ts:
                        x = genetic_text(int(t.cells[i]), group, annotated)
                        if x and x not in texts:
                            texts.append(x)
                    vals.append(", ".join(texts))
                yield [label, group, *vals]
        heat: dict[str, list[Track]] = {}
        for t in self.tracks:
            if t.kind == "heatmap":
                heat.setdefault("HEATMAP " + (t.meta.get("profileKind") or t.meta.get("profileType") or ""), []).append(t)
        for kind, ts in heat.items():
            for t in ts:
                exact = t.meta.get("values")
                vals = []
                for i in idx:
                    x = exact[i] if exact is not None else None
                    vals.append("" if int(t.cells[i]) == -1 or x is None or math.isnan(x) else _float32_text(x))
                yield [t.meta.get("gene") or t.label, kind, *vals]
        for t in self.tracks:
            if t.kind == "derivedEvent":
                yield [t.label, "DERIVED", *["yes" if int(t.cells[i]) > 0 else "no" for i in idx]]

    def to_tsv(self, path: str | None = None, order: Iterable[int] | None = None) -> str:
        text = "".join("\t".join(r) + "\n" for r in self.rows(order))
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        return text


def _float32_text(x: float) -> str:
    """a float32 value at the seven significant digits it holds, printed as JavaScript prints it (fmtFloat32)"""
    v = float(f"{x:.7g}")
    return str(int(v)) if v.is_integer() else repr(v)


def _jsnum(v: Any) -> Any:
    """JSON numbers the way JavaScript prints them: integral floats without a fraction."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, list):
        return [_jsnum(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsnum(x) for k, x in v.items()}
    return v


GENETIC_GROUPS = ("CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT")
# the portal's texts per mutation class (tabularDownload.ts mutationMap); splice and other named alike
_MUTATION_TEXT = {"TRUNCATING": "Truncating mutation", "SPLICE": "Splice Mutation", "INFRAME": "Inframe Mutation",
                  "PROMOTER": "Promoter Mutation", "MISSENSE": "Missense Mutation", "OTHER_MUT": "Other Mutation"}
_DRIVER, _PASSENGER = " (putative driver)", " (putative passenger)"


def genetic_text(code: int, group: str, annotated: bool) -> str:
    """a gene cell's text in one genetic group; "" when it has none of that kind or was not profiled"""
    if code == NOT_PROFILED or code <= 0:
        return ""
    if group == "MUTATIONS":
        bit = next((m["bit"] for m in STYLE["glyph"]["mutation"]["priority"] if code & BITS[m["bit"]]), None)
        if bit is None:
            return ""
        text = _MUTATION_TEXT[bit]
        return text if not annotated or bit == "PROMOTER" else text + (_DRIVER if code & BITS["MUT_DRIVER"] else _PASSENGER)
    if group == "CNA":
        text = "Amplification" if code & BITS["AMP"] else "Deep Deletion" if code & BITS["HOMDEL"] else ""
        return text + _DRIVER if text and annotated and code & BITS["CNA_DRIVER"] else text
    if group == "STRUCTURAL_VARIANT":
        return "Structural Variant" + (_DRIVER if annotated and code & BITS["SV_DRIVER"] else "") if code & BITS["SV"] else ""
    if group == "MRNA":
        return "mRNA High" if code & BITS["MRNA_HIGH"] else "mRNA Low" if code & BITS["MRNA_LOW"] else ""
    return "Protein High" if code & BITS["PROT_HIGH"] else "Protein Low" if code & BITS["PROT_LOW"] else ""


def _clinical_text(t: Track, i: int) -> str:
    c = int(t.cells[i])
    if t.meta.get("numeric"):
        if c == -1:
            return ""
        exact = t.meta.get("values")
        x = exact[i] if exact is not None else None
        return _float32_text(x) if x is not None and not math.isnan(x) else str(round(numeric_value(t.meta, c), 2))
    if c == -1:
        return STYLE["glyph"]["profiled"]["no"] if t.meta.get("profiledFor") else ""
    cats = t.meta.get("categories") or []
    return cats[c] if c < len(cats) else "Other"


# ---- OPB1 --------------------------------------------------------------------
def _pad4(n: int) -> int:
    return (n + 3) & ~3


def read_opb1(data: bytes | bytearray | memoryview) -> Contract:
    """Decode an OPB1 payload. Cell arrays are views over `data` (little-endian), no copy."""
    buf = memoryview(data)
    magic, header_len = struct.unpack_from(">II", buf, 0)
    if magic != _MAGIC:
        raise ValueError("not an OPB1 oncoprint payload")
    header = json.loads(bytes(buf[8: 8 + header_len]).decode("utf-8"))
    base = 8 + _pad4(header_len)
    tracks = []
    for m in header["tracks"]:
        dtype = np.dtype("<i2") if m["dtype"] == "i16" else np.dtype("<i4")
        cells = np.frombuffer(buf, dtype=dtype, count=m["length"], offset=base + m["offset"])
        meta = {k: v for k, v in m.items() if k not in ("kind", "label", "dtype", "offset", "length", "valuesOffset")}
        if "valuesOffset" in m:
            # a stacked row (the mutation spectrum) holds len(stack) values per column
            vals = np.frombuffer(buf, dtype="<f4", count=m["length"] * len(m.get("stack") or [0]), offset=base + m["valuesOffset"])
            meta["values"] = [None if math.isnan(x) else float(x) for x in vals]
        tracks.append(Track(m["kind"], m["label"], cells, meta))
    co, cb = header["columnsOffset"], header["columnsBytes"]
    columns = bytes(buf[base + co: base + co + cb]).decode("utf-8").split("\n") if cb else []
    return Contract(header["study"], header.get("studies") or [header["study"]], header["groups"], columns, tracks,
                    header.get("conventions", {}), header.get("stats", {}), header.get("unit", "patient"), header.get("display") or dict(DEFAULT_DISPLAY))


def write_opb1(c: Contract) -> bytes:
    """Encode a contract as OPB1, byte-compatible with lib/oncoprint-binary.ts."""
    col_bytes = "\n".join(c.columns).encode("utf-8")
    metas, blobs, cursor = [], [], 0
    for t in c.tracks:
        cells = np.asarray(t.cells)
        wide = bool(cells.size) and (int(cells.max()) > 32767 or int(cells.min()) < -32768)
        arr = cells.astype("<i4" if wide else "<i2")
        raw = arr.tobytes()
        meta = {k: v for k, v in t.meta.items() if k != "values"}
        m = {"kind": t.kind, "label": t.label, **meta, "dtype": "i32" if wide else "i16", "offset": cursor, "length": int(arr.size)}
        blobs.append(raw + b"\0" * (_pad4(len(raw)) - len(raw)))
        cursor += _pad4(len(raw))
        if t.meta.get("values") is not None:
            # a numeric track's exact values follow its cells, little-endian float32
            vals = np.asarray([np.nan if v is None else v for v in t.meta["values"]], dtype="<f4").tobytes()
            m["valuesOffset"] = cursor
            blobs.append(vals)
            cursor += len(vals)
        metas.append(m)
    header = {"study": c.study, "studies": c.studies, "unit": c.unit, "groups": c.groups, "conventions": c.conventions,
              "display": c.display or DEFAULT_DISPLAY, "stats": c.stats,
              "n": c.n, "tracks": metas, "columnsOffset": cursor, "columnsBytes": len(col_bytes), "format": "OPB1"}
    hb = json.dumps(header, separators=(",", ":")).encode("utf-8")
    out = bytearray(struct.pack(">II", _MAGIC, len(hb))) + hb + b"\0" * (_pad4(len(hb)) - len(hb))
    for b in blobs:
        out += b
    out += col_bytes
    return bytes(out)
