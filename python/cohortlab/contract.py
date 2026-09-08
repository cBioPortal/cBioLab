"""The oncoprint render contract and its OPB1 binary form.

Mirrors lib/types.ts (Contract, Track) and lib/oncoprint-binary.ts. Cells are numpy arrays,
one per track: gene tracks hold the alteration bitmask, numeric tracks 0..255, categorical
tracks a category index; -1 means not profiled / no data everywhere.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np

DEFAULT_DISPLAY: dict[str, Any] = {"showUnaltered": True, "whitespace": True, "gaps": "none", "clinicalLegends": "all",
                                   "colorByType": True, "hideVUS": False, "annotate": "oncokb", "whiteBackground": False}
BITS = {"MISSENSE": 1, "TRUNCATING": 2, "INFRAME": 4, "SPLICE": 8, "OTHER_MUT": 16, "SV": 32, "AMP": 64, "HOMDEL": 128, "DRIVER": 256}
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

    # ---- tabular export (the portal's "Tabular" download shape) -------------
    def rows(self) -> Iterable[list[str]]:
        yield ["track_name", "track_type", *self.columns]
        for t in self.tracks:
            if t.kind == "gene":
                vals = [gene_cell_label(int(c)) for c in t.cells]
                kind = "GENE"
            elif t.kind == "derivedEvent":
                vals = ["yes" if c > 0 else "no" for c in t.cells]
                kind = "DERIVED"
            elif t.meta.get("numeric"):
                lo, hi = t.meta.get("min", 0), t.meta.get("max", 1)
                vals = ["" if c == -1 else str(round(lo + (int(c) / 255.0) * (hi - lo), 2)) for c in t.cells]
                kind = "HEATMAP " + t.meta.get("profileType", "") if t.kind == "heatmap" else "CLINICAL"
            else:
                cats = t.meta.get("categories") or []
                vals = ["" if c == -1 else (cats[c] if c < len(cats) else "Other") for c in t.cells]
                kind = "CLINICAL"
            yield [t.label, kind, *vals]

    def to_tsv(self, path: str | None = None) -> str:
        text = "".join("\t".join(r) + "\n" for r in self.rows())
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        return text


def _jsnum(v: Any) -> Any:
    """JSON numbers the way JavaScript prints them: integral floats without a fraction."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def gene_cell_label(code: int) -> str:
    if code == NOT_PROFILED:
        return "not profiled"
    if code <= 0:
        return ""
    drv = " (putative driver)" if code & BITS["DRIVER"] else " (unknown significance)"
    parts = []
    for bit, name in (("MISSENSE", "Missense Mutation"), ("TRUNCATING", "Truncating Mutation"), ("INFRAME", "Inframe Mutation"),
                      ("SPLICE", "Splice Mutation"), ("OTHER_MUT", "Other Mutation"), ("SV", "Structural Variant")):
        if code & BITS[bit]:
            parts.append(name + drv)
    if code & BITS["AMP"]:
        parts.append("Amplification")
    if code & BITS["HOMDEL"]:
        parts.append("Deep Deletion")
    return ", ".join(parts)


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
        meta = {k: v for k, v in m.items() if k not in ("kind", "label", "dtype", "offset", "length")}
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
        metas.append({"kind": t.kind, "label": t.label, **t.meta, "dtype": "i32" if wide else "i16", "offset": cursor, "length": int(arr.size)})
        blobs.append(raw + b"\0" * (_pad4(len(raw)) - len(raw)))
        cursor += _pad4(len(raw))
    header = {"study": c.study, "studies": c.studies, "unit": c.unit, "groups": c.groups, "conventions": c.conventions,
              "display": c.display or DEFAULT_DISPLAY, "stats": c.stats,
              "n": c.n, "tracks": metas, "columnsOffset": cursor, "columnsBytes": len(col_bytes), "format": "OPB1"}
    hb = json.dumps(header, separators=(",", ":")).encode("utf-8")
    out = bytearray(struct.pack(">II", _MAGIC, len(hb))) + hb + b"\0" * (_pad4(len(hb)) - len(hb))
    for b in blobs:
        out += b
    out += col_bytes
    return bytes(out)
