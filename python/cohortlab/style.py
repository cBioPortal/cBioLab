"""The shared oncoprint style, read from style.json (generated from lib/oncoprint-style.ts).

`cell_layers`, `numeric_color`, `category_color`, `format_pct`, `format_label_pct`, `format_gutter_pct` and `truncate_label` are the
Python side of the same pure functions; the TypeScript module is the reference.
"""
from __future__ import annotations

import calendar
import json
import math
import os
import re
from typing import Any

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.json"), encoding="utf-8") as _f:
    STYLE: dict[str, Any] = json.load(_f)

BITS: dict[str, int] = STYLE["bits"]


def cell_layers(code: int, S: dict[str, Any] = STYLE) -> list[tuple[str, tuple[float, float], float]]:
    """Fills for one gene cell, bottom to top: (colour, (band from, band to), stroke px)."""
    G, B = S["glyph"], S["bits"]
    if code == -1:
        npf = G["notProfiled"]
        return [(npf["fill"], (0.0, 1.0), 0.0), (npf["stripe"]["color"], tuple(npf["stripe"]["band"]), 0.0)]
    out = [(S["palette"]["unaltered"], (0.0, 1.0), 0.0)]
    if code <= 0:
        return out
    for o in G["cna"]["options"]:
        if code & B[o["bit"]]:
            out.append((o["color"], tuple(G["cna"]["band"]), 0.0))
            break
    for o in G["mrna"]["options"]:
        if code & B[o["bit"]]:
            out.append((o["color"], tuple(G["mrna"]["band"]), float(G["mrna"]["stroke"])))
            break
    for o in G["protein"]["options"]:
        if code & B[o["bit"]]:
            out.append((o["color"], tuple(o["band"]), 0.0))
    if code & B[G["sv"]["bit"]]:
        out.append((G["sv"]["color"] if code & B["SV_DRIVER"] else G["sv"]["vus"], tuple(G["sv"]["band"]), 0.0))
    for m in G["mutation"]["priority"]:
        if code & B[m["bit"]]:
            out.append((m["color"] if code & B["MUT_DRIVER"] else m["vus"], tuple(G["mutation"]["band"]), 0.0))
            if code & B[G["germline"]["bit"]] and G["germline"]["show"]:
                out.append((G["germline"]["color"], tuple(G["germline"]["band"]), 0.0))
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


def ramp_rgb(ramp: dict[str, Any], v: float) -> tuple[int, int, int]:
    """A value on one of the portal's heatmap ramps (port of rampColor)."""
    stops, colors = ramp["stops"], ramp["colors"]
    if v <= stops[0]:
        return tuple(colors[0])  # type: ignore[return-value]
    for i in range(1, len(stops)):
        if v <= stops[i]:
            t = (v - stops[i - 1]) / ((stops[i] - stops[i - 1]) or 1)
            a, b = colors[i - 1], colors[i]
            return (_lerp(a[0], b[0], t), _lerp(a[1], b[1], t), _lerp(a[2], b[2], t))
    return tuple(colors[-1])  # type: ignore[return-value]


def heat_rgb(meta: dict[str, Any], code: int, S: dict[str, Any] = STYLE) -> tuple[int, int, int]:
    """A numeric cell's colour: its heatmap ramp when it has one (port of heatColor)."""
    if meta.get("ramp"):
        return ramp_rgb(S["ramps"][meta["ramp"]], numeric_value(meta, code))
    return numeric_rgb(code, meta.get("center"), S)


def numeric_color(v: float, center: float | None, S: dict[str, Any] = STYLE) -> str:
    r, g, b = numeric_rgb(v, center, S)
    return f"rgb({r},{g},{b})"


# ---- numeric cells (port of encodeNumeric / numericValue / barBand) ------------------------------

def _js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def encode_numeric(x: float, lo: float, hi: float, log_scale: bool = False) -> int:
    """The 0..255 code for value x on a track scaled over lo..hi (log(value + |lo| + 1) when log_scale)."""
    if log_scale:
        s = abs(lo) + 1
        base = math.log(lo + s)
        return _js_round(255 * (math.log(x + s) - base) / ((math.log(hi + s) - base) or 1))
    return _js_round(255 * (x - lo) / ((hi - lo) or 1))


def numeric_value(meta: dict[str, Any], code: int) -> float:
    """The value a numeric cell's code stands for."""
    lo, hi, f = meta.get("min", 0), meta.get("max", 1), code / 255
    if meta.get("logScale"):
        s = abs(lo) + 1
        base = math.log(lo + s)
        return math.exp(base + f * (math.log(hi + s) - base)) - s
    return lo + f * (hi - lo)


def bar_band(meta: dict[str, Any], code: int) -> tuple[tuple[float, float], bool]:
    """Where a bar sits in its cell (fractions of the row) and whether it is negative: the portal's bar rule."""
    lo, hi, f = meta.get("min", 0), meta.get("max", 1), code / 255
    if lo >= 0 or meta.get("logScale"):
        return (1 - f, 1.0), False
    if hi <= 0:
        return (0.0, 1 - f), True
    v = numeric_value(meta, code)
    r = v / max(-lo, hi)
    return ((0.5 - 0.5 * r, 0.5), False) if v >= 0 else ((0.5, 0.5 - 0.5 * r), True)


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


def format_label_pct(p: float | None) -> str:
    """The portal's track-label percent: "0%", "<1%" above 0 and under 1, otherwise an integer; N/P when nothing was profiled."""
    if p is None:
        return "N/P"
    if p == 0:
        return "0%"
    import math
    return "<1%" if p < 1 else f"{math.floor(p + 0.5)}%"


def format_gutter_pct(t: dict[str, Any], columns: int | None = None) -> str:
    """"driver% / any%" in the label format, from the counts when present; N/P when nothing was profiled; "*" over part of the columns."""
    profiled = t.get("profiled")

    def pct(n: Any, p: Any) -> float | None:
        return 100 * n / profiled if n is not None and profiled else p

    any_ = pct(t.get("altered"), t.get("freqPct"))
    if any_ is None:
        return "N/P"
    driver = pct(t.get("driverAltered"), t.get("driverPct"))
    star = "*" if profiled is not None and columns is not None and 0 < profiled < columns else ""
    return (format_label_pct(driver) + " / " if driver is not None else "") + format_label_pct(any_) + star


STAIRCASE_RADIX = 3 * 5 * 13 * 3 * 3 * 3


def staircase_rank(c: int, o: dict[str, Any] | None = None, S: dict[str, Any] = STYLE) -> int:
    """A gene row's cell, ranked as the portal's staircase ranks it, smaller first (lib/oncoprint-style.ts staircaseRank)."""
    o = o or {}
    B = S["bits"]
    by_type, by_driver, ignore_vus = o.get("byType", True), o.get("byDriver", True), bool(o.get("ignoreVus"))
    v = c if c > 0 else 0
    sv = 2 if not v & B["SV"] else 0 if v & B["SV_DRIVER"] else 2 if ignore_vus else 1 if by_driver else 0
    level = 0 if v & B["AMP"] else 1 if v & B["HOMDEL"] else -1
    cna_drv = bool(v & B["CNA_DRIVER"])
    cna = 4 if level < 0 else level if cna_drv else 4 if ignore_vus else 2 + level if by_driver else level
    cls = next((i for i, m in enumerate(S["glyph"]["mutation"]["priority"]) if v & B[m["bit"]]), -1)
    mut_drv = bool(v & B["MUT_DRIVER"])
    counted = cls >= 0 and (mut_drv or not ignore_vus)
    if not counted:
        mut = 12
    elif ignore_vus:
        mut = cls if by_type else 0
    elif by_type:
        mut = 6 + cls if by_driver and not mut_drv else cls
    else:
        mut = 1 if by_driver and not mut_drv else 0
    germ = (0 if v & B["GERMLINE"] else 1) if counted else 2
    mrna = 0 if v & B["MRNA_HIGH"] else 1 if v & B["MRNA_LOW"] else 2
    prot = 0 if v & B["PROT_HIGH"] else 1 if v & B["PROT_LOW"] else 2
    return ((((sv * 5 + cna) * 13 + mut) * 3 + germ) * 3 + mrna) * 3 + prot


def natural_vector(case_id: str) -> list[int]:
    """A case id as oncoprintjs orders it: each run of digits one number, every other character its code."""
    out: list[int] = []
    num = -1
    for ch in case_id:
        c = ord(ch)
        if 48 <= c <= 57:
            num = c - 48 if num < 0 else num * 10 + c - 48
            continue
        if num >= 0:
            out.append(num)
            num = -1
        out.append(c)
    if num >= 0:
        out.append(num)
    return out


# javascript-natural-sort 0.7.1 (Jim Palmer, MIT), as lib/oncoprint-style.ts naturalSort ports it
_NS_RE = re.compile(r"(\A([+\-]?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+\-]?\d+)?)?\Z|\A0x[0-9a-f]+\Z|\d+)", re.I | re.A)
_NS_SRE = re.compile(r"(\A[ ]*|[ ]*\Z)")
_NS_DRE = re.compile(r"(\A([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|\A\d{1,4}[\/\-]\d{1,4}[\/\-]\d{1,4}|\A\w+, \w+ \d+, \d{4})", re.A)
_NS_HRE = re.compile(r"\A0x[0-9a-f]+\Z", re.I)
_JS_FLOAT = re.compile(r"\A[\s\ufeff]*([+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))")
_JS_NUMBER = re.compile(r"\A[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\Z")
_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
_TIME = r"(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?"
_DATES = [
    (re.compile(r"\A(\d{4})[-/](\d{1,2})[-/](\d{1,2})" + _TIME + r"\Z", re.A), (1, 2, 3)),
    (re.compile(r"\A(\d{1,2})[-/](\d{1,2})[-/](\d{1,4})" + _TIME + r"\Z", re.A), (3, 1, 2)),
]
_DATE_WORDS = re.compile(r"\A(?:[A-Za-z]+, )?([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})" + _TIME + r"\Z")


def _js_parse_float(s: str) -> float:
    m = _JS_FLOAT.match(s)
    return float(m.group(1).replace("Infinity", "inf")) if m else math.nan


def _js_to_number(v: float | str) -> float:
    """Number(v), as isNaN coerces a string"""
    if not isinstance(v, str):
        return float(v)
    t = v.strip()
    if t == "":
        return 0.0
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
        return float(int(t[2:], 16))
    return float(t.replace("Infinity", "inf")) if _JS_NUMBER.match(t) else math.nan


def _js_str(v: float | str) -> str:
    """String(v) for a number, as JavaScript writes it"""
    if isinstance(v, str):
        return v
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == int(v) and abs(v) < 1e21:
        return str(int(v))
    r = repr(float(v))
    if "e" in r:
        mant, ex = r.split("e")
        e = int(ex)
        if -7 < e < 21:
            return format(float(v), "f").rstrip("0").rstrip(".")
        return mant + "e" + ("+" if e > 0 else "-") + str(abs(e))
    return r


def _js_date_parse(s: str) -> float:
    """Date.parse for the shapes the library hands it (V8, UTC); NaN for others"""
    for rx, (yi, mi, di) in _DATES:
        m = rx.match(s)
        if m:
            y, mo, d = int(m.group(yi)), int(m.group(mi)), int(m.group(di))
            if len(m.group(yi)) <= 2:
                y += 2000 if y < 50 else 1900
            return _utc_ms(y, mo, d, m.group(4), m.group(5), m.group(6))
    m = _DATE_WORDS.match(s)
    if m and m.group(1).lower() in _MONTHS:
        return _utc_ms(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)), m.group(4), m.group(5), m.group(6))
    return math.nan


def _utc_ms(y: int, mo: int, d: int, hh: str | None, mm: str | None, ss: str | None) -> float:
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return math.nan
    h, mi, se = int(hh or 0), int(mm or 0), int(ss or 0)
    days = (calendar.timegm((y, mo, 1, 0, 0, 0)) // 86400) + d - 1
    return float((days * 86400 + h * 3600 + mi * 60 + se) * 1000)


def _js_lt(a: float | str, b: float | str) -> bool:
    if isinstance(a, str) and isinstance(b, str):
        return a.encode("utf-16-be") < b.encode("utf-16-be")
    return _js_to_number(a) < _js_to_number(b)


def _ns_chunks(s: str) -> list[str]:
    if s == "":
        return [""]
    t = _NS_RE.sub(lambda m: "\0" + m.group(1) + "\0", s)
    t = re.sub(r"\x00\Z", "", t, count=1)
    t = re.sub(r"\A\x00", "", t, count=1)
    return t.split("\0")


def natural_sort(a: str, b: str) -> int:
    """javascript-natural-sort 0.7.1: the portal's order of a text track's values and of tied case ids."""
    x = _NS_SRE.sub("", str(a)) or ""
    y = _NS_SRE.sub("", str(b)) or ""
    xn, yn = _ns_chunks(x), _ns_chunks(y)

    def hexv(s: str) -> float:
        return float(int(s[2:], 16)) if _NS_HRE.match(s) else math.nan

    def truthy(v: Any) -> bool:
        return bool(v) and not (isinstance(v, float) and math.isnan(v))

    xd: Any = hexv(x)
    if not truthy(xd):
        xd = len(xn) != 1 and _NS_DRE.search(x) is not None and _js_date_parse(x)
    yd: Any = hexv(y)
    if not truthy(yd):
        yd = (truthy(xd) and _NS_DRE.search(y) is not None and _js_date_parse(y)) or None
        if not truthy(yd):
            yd = None
    if yd is not None:
        xv = 0.0 if xd is False or xd is None else float(xd)
        if xv < yd:
            return -1
        if xv > yd:
            return 1
    for c in range(max(len(xn), len(yn))):
        xs = xn[c] if c < len(xn) else ""
        ys = yn[c] if c < len(yn) else ""
        p: Any = (not xs.startswith("0") and _js_parse_float(xs)) if c < len(xn) else math.nan
        q: Any = (not ys.startswith("0") and _js_parse_float(ys)) if c < len(yn) else math.nan
        p = p if truthy(p) else (xs if c < len(xn) and xs else 0.0)
        q = q if truthy(q) else (ys if c < len(yn) and ys else 0.0)
        pn, qn = math.isnan(_js_to_number(p)), math.isnan(_js_to_number(q))
        if pn != qn:
            return 1 if pn else -1
        if isinstance(p, str) != isinstance(q, str):
            p, q = _js_str(p), _js_str(q)
        if _js_lt(p, q):
            return -1
        if _js_lt(q, p):
            return 1
    return 0


def natural_ranks(values: list[str]) -> list[int]:
    """each string's rank under natural_sort; strings it calls equal share a rank"""
    from functools import cmp_to_key
    idx = sorted(range(len(values)), key=cmp_to_key(lambda i, j: natural_sort(values[i], values[j])))
    rank = [0] * len(values)
    r = 0
    for k, i in enumerate(idx):
        if k and natural_sort(values[idx[k - 1]], values[i]) != 0:
            r = k
        rank[i] = r
    return rank


def truncate_label(label: str, S: dict[str, Any] = STYLE) -> str:
    n = S["geometry"]["labelMaxChars"]
    return label[: n - 1] + "…" if len(label) > n else label


def track_label_text(track: Any, S: dict[str, Any] = STYLE) -> str:
    """What the gutter prints: a merged gene row wears the brackets that spell it in a query."""
    members = (track.meta.get("members") if hasattr(track, "meta") else track.get("members")) or []
    label = track.label if hasattr(track, "label") else track["label"]
    if len(members) < 2:
        return truncate_label(label, S)
    open_b, close_b = S["geometry"]["mergedBrackets"]
    n = max(1, S["geometry"]["labelMaxChars"] - len(open_b) - len(close_b))
    return open_b + (label[: n - 1] + "…" if len(label) > n else label) + close_b


def glyph_presence(codes: Any, S: dict[str, Any] = STYLE) -> dict[str, Any]:
    """What gene cells draw, for a legend (port of glyphPresence): bits, and driver / VUS per band.

    `codes` may repeat; pass distinct ones (np.unique) for a large contract."""
    B, G = S["bits"], S["glyph"]
    out = {"bits": 0, "mutDriver": 0, "mutVus": 0, "svDriver": False, "svVus": False, "germline": False}
    for c in {int(x) for x in codes if int(x) > 0}:
        out["bits"] |= c
        if c & B[G["sv"]["bit"]]:
            out["svDriver" if c & B["SV_DRIVER"] else "svVus"] = True
        for m in G["mutation"]["priority"]:
            if c & B[m["bit"]]:
                out["mutDriver" if c & B["MUT_DRIVER"] else "mutVus"] |= B[m["bit"]]
                if c & B[G["germline"]["bit"]]:
                    out["germline"] = True
                break
    return out


def gene_legend(S: dict[str, Any] = STYLE, present: dict[str, Any] | None = None) -> list[tuple[str, str, str]]:
    """(label, colour, kind) in display order: mutations by priority, SV, CNA, mRNA, protein, not profiled.

    A glyph whose driver and VUS colours differ gets an entry for each; with `present`, only what the cells draw."""
    G, B, L = S["glyph"], S["bits"], S["glyph"]["driverLabels"]
    items: list[tuple[str, str, str]] = []

    def pair(e: dict[str, Any], drv: bool, vus: bool) -> None:
        if e["color"] == e["vus"]:
            if drv or vus:
                items.append((e["label"], e["color"], "swatch"))
            return
        if drv:
            items.append((e["label"] + L["driver"], e["color"], "swatch"))
        if vus:
            items.append((e["label"] + L["vus"], e["vus"], "swatch"))

    def has(bit: str) -> bool:
        return present is None or bool(present["bits"] & B[bit])

    for m in G["mutation"]["priority"]:
        pair(m, present is None or bool(present["mutDriver"] & B[m["bit"]]), present is None or bool(present["mutVus"] & B[m["bit"]]))
    if G["germline"]["show"] and (present is None or present.get("germline")):
        items.append((G["germline"]["label"], G["germline"]["color"], "germline"))
    pair(G["sv"], present is None or present["svDriver"], present is None or present["svVus"])
    items += [(o["label"], o["color"], "swatch") for o in G["cna"]["options"] if has(o["bit"])]
    items += [(o["label"], o["color"], "outline") for o in G["mrna"]["options"] if has(o["bit"])]
    items += [(o["label"], o["color"], "swatch") for o in G["protein"]["options"] if has(o["bit"])]
    items.append((G["notProfiled"]["label"], G["notProfiled"]["stripe"]["color"], "notProfiled"))
    seen: set[tuple[str, str]] = set()
    out = []
    for it in items:
        if (it[0], it[1]) not in seen:
            seen.add((it[0], it[1]))
            out.append(it)
    return out


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


def reserved_color(value: str, S: dict[str, Any] = STYLE) -> str | None:
    """The portal's fixed colour for a clinical value, if it has one (port of reservedColor)."""
    return S["palette"]["reserved"].get(_re.sub(r"\s", "", value).lower())


def track_category_color(track: Any, code: int, S: dict[str, Any] = STYLE, colors: dict[str, dict[str, str]] | None = None) -> str:
    """Colour for a categorical cell: display.colors[trackLabel][value], then a reserved colour, then the cycle."""
    cats = (track.meta.get("categories") if hasattr(track, "meta") else None) or []
    value = cats[code] if 0 <= code < len(cats) else None
    if value is not None and colors and track.label in colors:
        override = colors[track.label].get(value)
        if override:
            return override
    if hasattr(track, "meta") and track.meta.get("profiledFor"):
        return S["glyph"]["profiled"]["color"]
    if value is None:
        return category_color(code, S)
    reserved = reserved_color(value, S)
    if reserved:
        return reserved
    k = sum(1 for c in cats[:code] if not reserved_color(c, S))
    return clinical_color(k, S)


def clinical_color(k: int, S: dict[str, Any] = STYLE) -> str:
    """The k-th colour the portal hands a categorical track's values (port of clinicalColor)."""
    lst = S["palette"]["clinical"]
    c = lst[k % len(lst)]
    for _ in range(k // len(lst)):
        c = "#" + "".join(f"{math.floor(int(c[i:i + 2], 16) * 0.95 + 0.5):02x}" for i in (1, 3, 5))
    return c


def style_for_display(S: dict[str, Any], display: dict[str, Any] | None) -> dict[str, Any]:
    """The style a figure draws with, given its viewing options (port of styleForDisplay)."""
    d = display or {}
    out = S
    if d.get("colorByGermline") is False:
        out = {**out, "glyph": {**out["glyph"], "germline": {**out["glyph"]["germline"], "show": False}}}
    if d.get("colorByType") is False:
        one = out["glyph"]["mutation"]["single"]
        mut = {**out["glyph"]["mutation"], "priority": [{**m, "color": one["color"], "vus": one["vus"], "label": one["label"]}
                                                      for m in out["glyph"]["mutation"]["priority"]]}
        out = {**out, "glyph": {**out["glyph"], "mutation": mut}}
    if d.get("annotate") == "none":
        G = out["glyph"]
        out = {**out, "glyph": {**G, "sv": {**G["sv"], "vus": G["sv"]["color"]},
                                "mutation": {**G["mutation"], "priority": [{**m, "vus": m["color"]} for m in G["mutation"]["priority"]]}}}
    if d.get("whiteBackground"):
        out = {**out, "palette": {**out["palette"], "unaltered": "#ffffff"},
               "glyph": {**out["glyph"], "notProfiled": {**out["glyph"]["notProfiled"], "fill": "#ffffff"}}}
    return out
