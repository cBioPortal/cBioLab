"""The shared oncoprint style, read from style.json (generated from lib/oncoprint-style.ts).

`cell_layers`, `numeric_color`, `category_color`, `format_pct` and `truncate_label` are the
Python side of the same pure functions; the TypeScript module is the reference.
"""
from __future__ import annotations

import json
import os
from typing import Any

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.json"), encoding="utf-8") as _f:
    STYLE: dict[str, Any] = json.load(_f)

BITS: dict[str, int] = STYLE["bits"]


def cell_layers(code: int, S: dict[str, Any] = STYLE) -> list[tuple[str, tuple[float, float], float, float]]:
    """Fills for one gene cell, bottom to top: (colour, (band from, band to), alpha, stroke px)."""
    G, B = S["glyph"], S["bits"]
    if code == -1:
        npf = G["notProfiled"]
        return [(npf["fill"], (0.0, 1.0), 1.0, 0.0), (npf["stripe"]["color"], tuple(npf["stripe"]["band"]), 1.0, 0.0)]
    out = [(S["palette"]["unaltered"], (0.0, 1.0), 1.0, 0.0)]
    if code <= 0:
        return out
    driver = bool(code & B["DRIVER"])
    pair = G.get("vusStyle") == "pair"
    alpha = 1.0 if driver or pair else G["vusAlpha"]

    def paint(e: dict[str, Any]) -> str:
        return e["color"] if driver or not pair else e.get("vus", e["color"])

    for o in G["cna"]["options"]:
        if code & B[o["bit"]]:
            out.append((paint(o), tuple(G["cna"]["band"]), alpha, 0.0))
            break
    for o in G["mrna"]["options"]:
        if code & B[o["bit"]]:
            out.append((paint(o), tuple(G["mrna"]["band"]), 1.0, float(G["mrna"]["stroke"])))
            break
    for o in G["protein"]["options"]:
        if code & B[o["bit"]]:
            out.append((paint(o), tuple(o["band"]), 1.0, 0.0))
    if code & B[G["sv"]["bit"]]:
        out.append((paint(G["sv"]), tuple(G["sv"]["band"]), alpha, 0.0))
    for m in G["mutation"]["priority"]:
        if code & B[m["bit"]]:
            out.append((paint(m), tuple(G["mutation"]["band"]), alpha, 0.0))
            break
    return out


def _lerp(a: float, b: float, t: float) -> int:
    import math
    return int(math.floor(a + (b - a) * t + 0.5))


def numeric_rgb(v: float, center: float | None, S: dict[str, Any] = STYLE) -> tuple[int, int, int]:
    if center is None:
        t = max(0.0, min(1.0, v / 255.0))
        a, b = S["ramps"]["sequential"]["from"], S["ramps"]["sequential"]["to"]
        return (_lerp(a[0], b[0], t), _lerp(a[1], b[1], t), _lerp(a[2], b[2], t))
    d = S["ramps"]["diverging"]
    if v <= center:
        t = v / center if center else 1.0
        return (_lerp(d["low"][0], d["mid"][0], t), _lerp(d["low"][1], d["mid"][1], t), _lerp(d["low"][2], d["mid"][2], t))
    t = (v - center) / ((255 - center) or 1)
    return (_lerp(d["mid"][0], d["high"][0], t), _lerp(d["mid"][1], d["high"][1], t), _lerp(d["mid"][2], d["high"][2], t))


def numeric_color(v: float, center: float | None, S: dict[str, Any] = STYLE) -> str:
    r, g, b = numeric_rgb(v, center, S)
    return f"rgb({r},{g},{b})"


def category_color(i: int, S: dict[str, Any] = STYLE) -> str:
    cats = S["palette"]["categorical"]
    return cats[i % len(cats)]


def format_pct(p: float | None) -> str:
    """Integer at 3 % and above, one decimal below, N/P when nothing is profiled."""
    if p is None:
        return "N/P"
    import math
    v = math.floor(p * 10 + 0.5) / 10 if p < 3 else math.floor(p + 0.5)
    return (str(v) if p < 3 else str(int(v))) + "%"


def format_gutter_pct(driver_pct: float | None, freq_pct: float | None, profiled: int | None = None, columns: int | None = None) -> str:
    if freq_pct is None:
        return "N/P"
    star = "*" if profiled is not None and columns is not None and 0 < profiled < columns else ""
    return (f"{driver_pct}% / {freq_pct}%" if driver_pct is not None else f"{freq_pct}%") + star


def truncate_label(label: str, S: dict[str, Any] = STYLE) -> str:
    n = S["geometry"]["labelMaxChars"]
    return label[: n - 1] + "…" if len(label) > n else label


def gene_legend(S: dict[str, Any] = STYLE) -> list[tuple[str, str, str]]:
    """(label, colour, kind) in display order: mutations by priority, SV, CNA, mRNA, protein, not profiled."""
    G = S["glyph"]
    items = [(m["label"], m["color"], "swatch") for m in G["mutation"]["priority"]]
    items.append((G["sv"]["label"], G["sv"]["color"], "swatch"))
    items += [(o["label"], o["color"], "swatch") for o in G["cna"]["options"]]
    items += [(o["label"], o["color"], "outline") for o in G["mrna"]["options"]]
    items += [(o["label"], o["color"], "swatch") for o in G["protein"]["options"]]
    items.append((G["notProfiled"]["label"], G["notProfiled"]["stripe"]["color"], "notProfiled"))
    return items


# ---- user overrides ----------------------------------------------------------
# Port of resolveStyle in lib/oncoprint-style.ts: deep-merge onto the defaults with loud
# validation. Keys that change meaning rather than appearance are refused.
import re as _re

_COLOR_RE = _re.compile(r"^#[0-9a-fA-F]{6}$")


def _is_color(v: Any) -> bool:
    return isinstance(v, str) and bool(_COLOR_RE.match(v))


def _merge_into(base: Any, over: Any, path: str) -> Any:
    if path in ("bits", "version"):
        raise ValueError(f"style.{path} is read-only: it defines what a cell means, not how it looks")
    if isinstance(base, dict):
        if not isinstance(over, dict):
            raise ValueError(f"style.{path} must be an object")
        out = dict(base)
        for k, v in over.items():
            if k not in base:
                where = f"{path}.{k}" if path else k
                raise ValueError(f"style.{where} is not a style key (accepted here: {', '.join(base)})")
            out[k] = _merge_into(base[k], v, f"{path}.{k}" if path else k)
        return out
    if isinstance(base, list):
        if not isinstance(over, list):
            raise ValueError(f"style.{path} must be an array")
        if base and isinstance(base[0], dict) and "bit" in base[0]:
            if len(over) != len(base):
                raise ValueError(f"style.{path}: keep all {len(base)} entries; only their colour and label may change")
            out = []
            for i, (b, o) in enumerate(zip(base, over)):
                if not isinstance(o, dict):
                    raise ValueError(f"style.{path}[{i}] must be an object")
                if "bit" in o and o["bit"] != b["bit"]:
                    raise ValueError(f"style.{path}[{i}].bit is read-only: reordering alteration priority changes what a mixed cell means")
                out.append(_merge_into(b, o, f"{path}[{i}]"))
            return out
        for i, v in enumerate(over):
            if base and _is_color(base[0]) and not _is_color(v):
                raise ValueError(f"style.{path}[{i}]: '{v}' is not a #rrggbb colour")
            if base and isinstance(base[0], (int, float)) and not isinstance(v, (int, float)):
                raise ValueError(f"style.{path}[{i}] must be a number")
        return list(over)
    if _is_color(base) and not _is_color(over):
        raise ValueError(f"style.{path}: '{over}' is not a #rrggbb colour")
    if isinstance(base, bool) and not isinstance(over, bool):
        raise ValueError(f"style.{path} must be true or false")
    if isinstance(base, (int, float)) and not isinstance(base, bool) and not isinstance(over, (int, float)):
        raise ValueError(f"style.{path} must be a number")
    if isinstance(base, str) and not isinstance(over, str):
        raise ValueError(f"style.{path} must be a string")
    return over


def resolve_style(overrides: dict[str, Any] | None = None, S: dict[str, Any] = STYLE) -> dict[str, Any]:
    """Defaults with `overrides` merged on top; the defaults themselves when there is nothing to merge."""
    if not overrides:
        return S
    merged = _merge_into(S, overrides, "")
    npf = merged["glyph"]["notProfiled"]
    if npf["fill"] == merged["palette"]["unaltered"] and npf["stripe"]["color"] == merged["palette"]["unaltered"]:
        raise ValueError("style: not-profiled would be indistinguishable from unaltered — give glyph.notProfiled a different fill or stripe")
    return merged


def track_category_color(track: Any, code: int, S: dict[str, Any] = STYLE, colors: dict[str, dict[str, str]] | None = None) -> str:
    """Colour for a categorical cell, honouring display.colors[trackLabel][value]."""
    cats = (track.meta.get("categories") if hasattr(track, "meta") else None) or []
    value = cats[code] if 0 <= code < len(cats) else None
    if value is not None and colors and track.label in colors:
        override = colors[track.label].get(value)
        if override:
            return override
    return category_color(code, S)
