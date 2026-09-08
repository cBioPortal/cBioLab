"""Level-of-detail raster of a contract with numpy; figures with matplotlib when available.

Same rule as the browser renderer (app/oncoprint-lab/canvas.ts): at most one bucket per
output pixel per track when columns are narrower than a pixel — OR for gene tracks, mean
for numeric, mode for categorical — and one cell per column above that. A 400k-column
contract rasterises to a 1500-px-wide image in tens of milliseconds.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .contract import BITS, NOT_PROFILED, Contract, Track

PALETTE = {
    "paper": "#ffffff", "unaltered": "#e8ecee", "np": "#f4f6f7", "npStripe": "#dfe4e7",
    "amp": "#e41a1c", "homdel": "#2166ac", "sv": "#8e24aa",
    "missense": "#2e7d32", "truncating": "#111111", "inframe": "#b8860b", "splice": "#ff8c00", "otherMut": "#9467bd",
    "derived": "#0f86a1", "text": "#1f2933", "muted": "#5b6b76",
}
CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"]
ROW_H, ROW_GAP, GROUP_GAP = 20, 3, 10


def _rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def _heat(v: np.ndarray) -> np.ndarray:
    t = np.clip(v / 255.0, 0, 1)[:, None]
    return np.array([222, 235, 247]) + (np.array([8, 72, 135]) - np.array([222, 235, 247])) * t


def _diverging(v: np.ndarray, c: float) -> np.ndarray:
    lo, mid, hi = np.array([33, 102, 172]), np.array([255, 255, 255]), np.array([178, 24, 43])
    t0 = np.where(c > 0, v / max(c, 1e-9), 1.0)[:, None]
    t1 = ((v - c) / max(255 - c, 1e-9))[:, None]
    return np.where(v[:, None] <= c, lo + (mid - lo) * np.clip(t0, 0, 1), mid + (hi - mid) * np.clip(t1, 0, 1))


def bucket_edges(n: int, width_px: int) -> np.ndarray:
    """Column index boundaries for `width_px` buckets over `n` columns (last edge = n)."""
    if n <= width_px:
        return np.arange(n + 1, dtype=np.intp)
    return np.unique(np.floor(np.arange(width_px + 1) * n / width_px).astype(np.intp))


def aggregate(track: Track, cells: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """One display code per bucket, per track kind (matches canvas.ts `aggregate`)."""
    starts = np.asarray(edges[:-1], dtype=np.intp)  # reduceat wants platform-width indices (32-bit under WebAssembly)
    if track.meta.get("numeric"):
        valid = cells != -1
        s = np.add.reduceat(np.where(valid, cells, 0).astype(np.int64), starts)
        k = np.add.reduceat(valid.astype(np.int64), starts)
        return np.where(k > 0, np.floor(s / np.maximum(k, 1) + 0.5), -1).astype(np.int64)
    if track.kind == "clinical" and track.meta.get("categories") is not None:
        m = len(track.meta["categories"]) + 1
        if m <= 1:
            return np.full(len(starts), -1, dtype=np.int64)
        onehot = np.zeros((len(cells), m), dtype=np.int32)
        ok = (cells >= 0) & (cells < m)
        onehot[np.nonzero(ok)[0], cells[ok]] = 1
        counts = np.add.reduceat(onehot, starts, axis=0)
        code = counts.argmax(axis=1)
        return np.where(counts.sum(axis=1) > 0, code, -1)
    prof = cells != -1
    code = np.bitwise_or.reduceat(np.where(cells > 0, cells, 0).astype(np.int64), starts)
    any_prof = np.add.reduceat(prof.astype(np.int64), starts) > 0
    return np.where(any_prof, code, -1)


def raster(c: Contract, width: int = 1200, gutter: int = 0, palette: dict[str, str] = PALETTE) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """RGB uint8 image of the tracks (no text), plus per-group pixel extents for annotation."""
    P = {k: _rgb(v) for k, v in palette.items()}
    plot_w = max(1, width - gutter - GROUP_GAP * max(0, len(c.groups) - 1))
    n = max(1, c.n)
    px_per_col = plot_w / n
    H = len(c.tracks) * (ROW_H + ROW_GAP)
    img = np.tile(P["paper"], (H, width, 1))
    x = gutter
    extents = []
    for g in c.groups:
        gw = max(1, int(round(g["count"] * px_per_col)))
        edges = bucket_edges(g["count"], gw)
        nb = len(edges) - 1
        bw = np.diff(np.floor(edges * gw / max(g["count"], 1))).astype(int) if g["count"] > gw else np.full(nb, max(1, int(px_per_col)))
        xs = x + np.concatenate([[0], np.cumsum(bw)[:-1]])
        extents.append({"name": g["name"], "x0": x, "x1": x + int(bw.sum()), "count": g["count"]})
        for ti, t in enumerate(c.tracks):
            y0 = ti * (ROW_H + ROW_GAP)
            codes = aggregate(t, np.asarray(t.cells[g["start"]: g["start"] + g["count"]]), edges)
            rows = _row_colors(t, codes, P)  # (nb, layers) -> list of (y_from, y_to, colors)
            for (yf, yt), cols in rows:
                for bi in range(nb):
                    col = cols[bi]
                    if col is None:
                        continue
                    img[y0 + yf: y0 + yt, xs[bi]: xs[bi] + bw[bi]] = col
        x += int(bw.sum()) + GROUP_GAP
    return np.clip(img, 0, 255).astype(np.uint8), extents


def _row_colors(t: Track, codes: np.ndarray, P: dict[str, np.ndarray]):
    nb = len(codes)
    none = [None] * nb
    if t.kind == "gene":
        base = [P["np"] if c == -1 else P["unaltered"] for c in codes]
        stripe = [P["npStripe"] if c == -1 else None for c in codes]
        cna, sv, mut = list(none), list(none), list(none)
        for i, c in enumerate(codes):
            if c <= 0:
                continue
            fade = 0.35 if not (c & BITS["DRIVER"]) else 1.0
            mix = lambda col: P["unaltered"] + (col - P["unaltered"]) * fade
            if c & BITS["AMP"]:
                cna[i] = mix(P["amp"])
            elif c & BITS["HOMDEL"]:
                cna[i] = mix(P["homdel"])
            if c & BITS["SV"]:
                sv[i] = mix(P["sv"]) if cna[i] is None else cna[i] + (P["sv"] - cna[i]) * fade
            base_for_mut = mut_base = sv[i] if sv[i] is not None else cna[i] if cna[i] is not None else P["unaltered"]
            for bit, key in (("MISSENSE", "missense"), ("TRUNCATING", "truncating"), ("INFRAME", "inframe"), ("SPLICE", "splice"), ("OTHER_MUT", "otherMut")):
                if c & BITS[bit]:
                    mut[i] = mut_base + (P[key] - mut_base) * fade
                    break
        return [((0, ROW_H), base), ((int(ROW_H * 0.45), int(ROW_H * 0.55)), stripe), ((0, ROW_H), cna),
                ((int(ROW_H * 0.15), int(ROW_H * 0.85)), sv), ((int(ROW_H * 0.3), int(ROW_H * 0.7)), mut)]
    if t.kind == "derivedEvent":
        return [((0, ROW_H), [P["derived"] if c > 0 else P["unaltered"] for c in codes])]
    if t.meta.get("numeric"):
        v = codes.astype(np.float64)
        cols = _diverging(v, float(t.meta["center"])) if t.meta.get("center") is not None else _heat(v)
        return [((0, ROW_H), [P["np"] if c == -1 else cols[i] for i, c in enumerate(codes)])]
    return [((0, ROW_H), [P["np"] if c == -1 else _rgb(CAT_COLORS[int(c) % len(CAT_COLORS)]) for c in codes])]


def figure(c: Contract, width: int = 1200, gutter: int = 170, dpi: int = 100, title: str | None = None):
    """A matplotlib Figure: gutter with labels and frequencies, group headers, tracks, legend."""
    import matplotlib
    matplotlib.use("Agg", force=False)
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    img, extents = raster(c, width=width, gutter=gutter)
    H = img.shape[0]
    header, legend_in = 24, 0.45
    fig_h = (H + header) / dpi + legend_in + 0.1
    fig = plt.figure(figsize=(width / dpi, fig_h), dpi=dpi)
    ax = fig.add_axes([0, (legend_in + 0.05) / fig_h, 1, (H + header) / dpi / fig_h])
    ax.imshow(img, extent=(0, width, H, 0), interpolation="nearest", aspect="auto")
    ax.set_xlim(0, width)
    ax.set_ylim(H, -header)
    ax.axis("off")
    for e in extents:
        ax.text(e["x0"], -header / 2, f'{e["name"]} ({e["count"]:,})', fontsize=8, color=PALETTE["muted"], va="center", clip_on=True)
    for ti, t in enumerate(c.tracks):
        y = ti * (ROW_H + ROW_GAP) + ROW_H / 2
        ax.text(4, y, t.label[:17] + ("…" if len(t.label) > 17 else ""), fontsize=8, color=PALETTE["text"], va="center")
        if t.meta.get("freqPct") is not None:
            lab = f'{t.meta["driverPct"]}% / {t.meta["freqPct"]}%' if t.meta.get("driverPct") is not None else f'{t.meta["freqPct"]}%'
            ax.text(gutter - 8, y, lab, fontsize=7.5, color=PALETTE["muted"], va="center", ha="right")
    handles = [Patch(color=PALETTE[k], label=l) for k, l in (("amp", "Amp"), ("homdel", "Deep Del"), ("sv", "SV"), ("missense", "Missense"),
                                                                ("truncating", "Truncating"), ("inframe", "In-frame"), ("splice", "Splice"), ("otherMut", "Other"), ("npStripe", "Not profiled"))]
    fig.legend(handles=handles, loc="lower left", ncol=9, fontsize=7.5, frameon=False, bbox_to_anchor=(0.005, 0.0), handlelength=1.2, columnspacing=1.2)
    if title:
        fig.suptitle(title, fontsize=9, x=0.005, ha="left")
    return fig


def save(c: Contract, path: str, width: int = 1200, **kw) -> str:
    fig = figure(c, width=width, **kw)
    fig.savefig(path)
    import matplotlib.pyplot as plt
    plt.close(fig)
    return path
