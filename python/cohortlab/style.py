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


def cell_layers(code: int, S: dict[str, Any] = STYLE) -> list[tuple[str, tuple[float, float], float]]:
    """Fills for one gene cell, bottom to top: (colour, (band from, band to), alpha)."""
    G, B = S["glyph"], S["bits"]
    if code == -1:
        npf = G["notProfiled"]
        return [(npf["fill"], (0.0, 1.0), 1.0), (npf["stripe"]["color"], tuple(npf["stripe"]["band"]), 1.0)]
    out = [(S["palette"]["unaltered"], (0.0, 1.0), 1.0)]
    if code <= 0:
        return out
    alpha = 1.0 if code & B["DRIVER"] else G["vusAlpha"]
    for o in G["cna"]["options"]:
        if code & B[o["bit"]]:
            out.append((o["color"], tuple(G["cna"]["band"]), alpha))
            break
    if code & B[G["sv"]["bit"]]:
        out.append((G["sv"]["color"], tuple(G["sv"]["band"]), alpha))
    for m in G["mutation"]["priority"]:
        if code & B[m["bit"]]:
            out.append((m["color"], tuple(G["mutation"]["band"]), alpha))
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


def format_gutter_pct(driver_pct: float | None, freq_pct: float | None) -> str:
    if freq_pct is None:
        return "N/P"
    return f"{driver_pct}% / {freq_pct}%" if driver_pct is not None else f"{freq_pct}%"


def truncate_label(label: str, S: dict[str, Any] = STYLE) -> str:
    n = S["geometry"]["labelMaxChars"]
    return label[: n - 1] + "…" if len(label) > n else label


def gene_legend(S: dict[str, Any] = STYLE) -> list[tuple[str, str, str]]:
    """(label, colour, kind) in display order: mutations by priority, SV, CNA, not profiled."""
    G = S["glyph"]
    items = [(m["label"], m["color"], "swatch") for m in G["mutation"]["priority"]]
    items.append((G["sv"]["label"], G["sv"]["color"], "swatch"))
    items += [(o["label"], o["color"], "swatch") for o in G["cna"]["options"]]
    items.append((G["notProfiled"]["label"], G["notProfiled"]["stripe"]["color"], "notProfiled"))
    return items
