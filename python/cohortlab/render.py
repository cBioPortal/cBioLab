"""Level-of-detail raster of a contract with numpy; figures with matplotlib when available.

Same rule as the browser and SVG renderers (lib/oncoprint-lod.ts): at most one bucket per
output pixel per track when columns are narrower than a pixel — OR for gene tracks, mean for
numeric, mode for categorical — and one cell per column above that. Colours, bands, the
mutation priority and legend labels come from the shared style (style.json). A 400k-column
contract rasterises to a 1500-px-wide image in tens of milliseconds.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .contract import Contract, Track
from .style import BITS, STYLE, cell_layers, format_gutter_pct, gene_legend, glyph_presence, numeric_rgb, resolve_style, style_for_display, track_category_color, track_label_text

_G = STYLE["geometry"]
_MUT = BITS["MISSENSE"] | BITS["TRUNCATING"] | BITS["INFRAME"] | BITS["SPLICE"] | BITS["OTHER_MUT"] | BITS["PROMOTER"]
ROW_H, ROW_GAP, GROUP_GAP = _G["rowH"], _G["rowGap"], _G["groupGap"]


def _rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def bucket_edges(n: int, buckets: int) -> np.ndarray:
    """Column index boundaries for `buckets` buckets over `n` columns (mirrors lod.bucketEdges)."""
    nb = max(1, min(n, int(buckets)))
    edges = np.floor(np.arange(nb) * n / nb).astype(np.intp)
    return np.append(edges, np.intp(n))


def aggregate(track: Track, cells: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """One display code per bucket, per track kind (mirrors lod.aggregate)."""
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
        code = counts.argmax(axis=1)  # first maximum: ties go to the lower index
        return np.where(counts.sum(axis=1) > 0, code, -1)
    # OR of the altered bitmasks, the mutation classes taken from driver-mutation columns when a
    # bucket has any (the portal's precedence), else from every column
    prof = cells != -1
    alt = np.where(cells > 0, cells, 0).astype(np.int64)
    mut = alt & _MUT
    drv = (alt & BITS["MUT_DRIVER"]) != 0
    code = np.bitwise_or.reduceat(alt & ~_MUT, starts)
    drv_mut = np.bitwise_or.reduceat(np.where(drv, mut, 0), starts)
    vus_mut = np.bitwise_or.reduceat(np.where(drv, 0, mut), starts)
    any_prof = np.add.reduceat(prof.astype(np.int64), starts) > 0
    return np.where(any_prof, code | np.where(drv_mut > 0, drv_mut, vus_mut), -1)


def bucket_codes(c: Contract, buckets: int) -> list[dict[str, Any]]:
    """Per group, per track, the bucket codes — the shape the conformance test compares with the node CLI."""
    out = []
    for g in c.groups:
        edges = bucket_edges(g["count"], buckets)
        tracks = {t.label: [int(x) for x in aggregate(t, np.asarray(t.cells[g["start"]: g["start"] + g["count"]]), edges)] for t in c.tracks}
        out.append({"name": g["name"], "edges": [int(e) for e in edges], "tracks": tracks})
    return out


def raster(c: Contract, width: int = 1200, gutter: int = 0, style: dict[str, Any] | None = None) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """RGB uint8 image of the tracks (no text), plus per-group pixel extents for annotation.

    The figure's own style travels in the contract (`display.style`), so callers pass nothing.
    """
    S = style_for_display(style or resolve_style((c.display or {}).get("style")), c.display)
    colors = (c.display or {}).get("colors")
    P = S["palette"]
    paper, unaltered, derived = _rgb(P["paper"]), _rgb(P["unaltered"]), _rgb(P["derived"])
    npfill = _rgb(S["glyph"]["notProfiled"]["fill"])
    npstripe, npband = _rgb(S["glyph"]["notProfiled"]["stripe"]["color"]), S["glyph"]["notProfiled"]["stripe"]["band"]
    plot_w = max(1, width - gutter - GROUP_GAP * max(0, len(c.groups) - 1))
    n = max(1, c.n)
    px_per_col = plot_w / n
    H = len(c.tracks) * (ROW_H + ROW_GAP)
    img = np.tile(paper, (H, width, 1))
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
            for bi in range(nb):
                x0, x1 = int(xs[bi]), int(xs[bi] + bw[bi])
                code = int(codes[bi])
                if t.kind == "gene":
                    for color, (b0, b1), stroke in cell_layers(code, S):
                        col = _rgb(color)
                        if stroke:
                            sw = max(1, int(min(stroke, max(1, (x1 - x0) // 2))))
                            img[y0:y0 + sw, x0:x1] = col
                            img[y0 + ROW_H - sw:y0 + ROW_H, x0:x1] = col
                            img[y0:y0 + ROW_H, x0:x0 + sw] = col
                            img[y0:y0 + ROW_H, max(x0, x1 - sw):x1] = col
                            continue
                        ya, yb = y0 + int(ROW_H * b0), y0 + int(ROW_H * b1)
                        img[ya:yb, x0:x1] = col
                elif t.kind == "derivedEvent":
                    img[y0:y0 + ROW_H, x0:x1] = derived if code > 0 else unaltered
                elif code == -1:
                    # the portal's no-data glyph: the not-profiled cell's white and midline
                    img[y0:y0 + ROW_H, x0:x1] = npfill
                    img[y0 + int(ROW_H * npband[0]):y0 + int(ROW_H * npband[1]), x0:x1] = npstripe
                elif t.meta.get("numeric"):
                    img[y0:y0 + ROW_H, x0:x1] = np.array(numeric_rgb(code, t.meta.get("center"), S), dtype=np.float64)
                else:
                    img[y0:y0 + ROW_H, x0:x1] = _rgb(track_category_color(t, code, S, colors))
        x += int(bw.sum()) + GROUP_GAP
    return np.clip(img, 0, 255).astype(np.uint8), extents


def figure(c: Contract, width: int = 1200, gutter: int | None = None, dpi: int = 100, title: str | None = None,
           style: dict[str, Any] | None = None):
    """A matplotlib Figure: gutter with labels and frequencies, group headers, tracks, legend."""
    import matplotlib
    matplotlib.use("Agg", force=False)
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    S = style_for_display(style or resolve_style((c.display or {}).get("style")), c.display)
    gutter = S["geometry"]["gutter"] if gutter is None else gutter
    P = S["palette"]
    img, extents = raster(c, width=width, gutter=gutter, style=S)
    H = img.shape[0]
    header, legend_in = _G["header"], 0.45
    fig_h = (H + header) / dpi + legend_in + 0.1
    fig = plt.figure(figsize=(width / dpi, fig_h), dpi=dpi)
    ax = fig.add_axes([0, (legend_in + 0.05) / fig_h, 1, (H + header) / dpi / fig_h])
    ax.imshow(img, extent=(0, width, H, 0), interpolation="nearest", aspect="auto")
    ax.set_xlim(0, width)
    ax.set_ylim(H, -header)
    ax.axis("off")
    for e in extents:
        ax.text(e["x0"], -header / 2, f'{e["name"]} ({e["count"]:,})', fontsize=8, color=P["muted"], va="center", clip_on=True)
    for ti, t in enumerate(c.tracks):
        y = ti * (ROW_H + ROW_GAP) + ROW_H / 2
        ax.text(4, y, track_label_text(t, S), fontsize=8, color=P["text"], va="center")
        if t.meta.get("freqPct") is not None:
            ax.text(gutter - 8, y, format_gutter_pct(t.meta.get("driverPct"), t.meta.get("freqPct"), t.meta.get("profiled"), c.n), fontsize=7.5, color=P["muted"], va="center", ha="right")
    gene_cells = np.concatenate([np.asarray(t.cells) for t in c.tracks if t.kind == "gene"] or [np.zeros(0, dtype=np.int32)])
    present = glyph_presence(np.unique(gene_cells[gene_cells > 0]), S)
    handles = [Patch(color=color, label=label) for label, color, kind in gene_legend(S, present)]
    if any(t.kind == "derivedEvent" for t in c.tracks):
        handles.append(Patch(color=P["derived"], label="Derived event"))
    fig.legend(handles=handles, loc="lower left", ncol=len(handles), fontsize=7, frameon=False, bbox_to_anchor=(0.005, 0.0), handlelength=1.2, columnspacing=1.0)
    if title:
        fig.suptitle(title, fontsize=9, x=0.005, ha="left")
    return fig


def save(c: Contract, path: str, width: int = 1200, **kw) -> str:
    fig = figure(c, width=width, **kw)
    fig.savefig(path)
    import matplotlib.pyplot as plt
    plt.close(fig)
    return path
