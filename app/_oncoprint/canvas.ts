// Level-of-detail Canvas 2D renderer over the oncoprint render contract.
//
// The contract is column-major typed arrays; the renderer draws at most one
// bucket per screen pixel per track when zoomed out, and one rect per column
// when zoomed in. Per-frame cost is bounded by (visible pixels × tracks) plus one
// pass over the visible columns, never by the size of the cohort.
//
// `order` is an indirection over contract columns (k-space -> column index) so
// hiding unaltered columns or re-sorting on the client never touches the data.
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";

import { STYLE, cellLayers, numericColor as styleNumericColor, trackCategoryColor, formatPct, formatGutterPct, truncateLabel, trackLabelText, resolveStyle, type Style } from "../../lib/oncoprint-style.ts";
export { resolveStyle, type Style };
import { aggregate as lodAggregate } from "../../lib/oncoprint-lod.ts";

export const BITS = STYLE.bits;
export const CAT_COLORS = STYLE.palette.categorical;
export const PALETTE = {
  paper: STYLE.palette.paper, unaltered: STYLE.palette.unaltered, np: STYLE.glyph.notProfiled.fill, npStripe: STYLE.glyph.notProfiled.stripe.color,
  derived: STYLE.palette.derived, text: STYLE.palette.text, muted: STYLE.palette.muted, groupLine: STYLE.palette.groupLine
};
export type Palette = typeof PALETTE;

/**
 * Drawing geometry. Mutable on purpose: the minimap draws the same figure at three pixels a
 * row with no gutter by swapping these for one call and putting them back, rather than
 * threading a geometry argument through every function for one caller.
 */
export const GEOM = { header: STYLE.geometry.header, rowH: STYLE.geometry.rowH, rowGap: STYLE.geometry.rowGap, gutter: STYLE.geometry.gutter, groupGap: STYLE.geometry.groupGap, footer: 10 };

export interface VisibleGroup {
  name: string; start: number; count: number; patients: number;
  /** per track index: altered / profiled within this run (gene and derived tracks), null otherwise */
  pct?: (number | null)[];
}
export interface View { zoom: number; scrollX: number; whitespace: boolean }
export type Cells = Int16Array | Int32Array;

/**
 * The space between groups: a width, or a width plus the outer edge that also gets one. Groups
 * labelled with their percentages put each label in the gap on one side, so the first (left) or
 * last (right) group needs a gap at the figure's edge too.
 */
export type Gap = number | { px: number; edge: "left" | "right" };
function gapOf(gap: Gap): { px: number; lead: number; trail: number } {
  if (typeof gap === "number") return { px: gap, lead: 0, trail: 0 };
  return { px: gap.px, lead: gap.edge === "left" ? gap.px : 0, trail: gap.edge === "right" ? gap.px : 0 };
}

/** Virtual x (px, before scroll) where each group's first column starts. */
export function groupOffsets(groups: VisibleGroup[], zoom: number, gap: Gap = GEOM.groupGap): number[] {
  const { px, lead } = gapOf(gap);
  const out: number[] = []; let x = lead;
  for (const g of groups) { out.push(x); x += g.count * zoom + px; }
  return out;
}
function gapsWidth(groups: VisibleGroup[], gap: Gap): number {
  const { px, lead, trail } = gapOf(gap);
  return Math.max(0, groups.length - 1) * px + (groups.length ? lead + trail : 0);
}
export function virtualWidth(groups: VisibleGroup[], zoom: number, gap: Gap = GEOM.groupGap): number {
  return groups.reduce((w, g) => w + g.count * zoom, 0) + gapsWidth(groups, gap);
}
export function fitZoom(groups: VisibleGroup[], plotW: number, gap: Gap = GEOM.groupGap): number {
  const n = groups.reduce((s, g) => s + g.count, 0);
  return n ? Math.max(1e-6, (plotW - gapsWidth(groups, gap)) / n) : 1;
}

export { formatPct };

/**
 * Split each group into runs of one categorical track's value (the columns must already be
 * sorted by that track, so runs are contiguous). Each run becomes its own group, named by the
 * category, optionally carrying per-track altered / profiled percentages for gap labels.
 */
export function segmentByTrack(data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[], trackLabel: string, withPct: boolean): VisibleGroup[] {
  const t = data.tracks.find((x) => x.label === trackLabel);
  if (!t || !t.categories) return groups;
  const cats = t.categories;
  const nameOf = (c: number): string => c === -1 ? "no data" : cats[c] ?? "Other";
  const out: VisibleGroup[] = [];
  const multi = groups.length > 1;
  for (const g of groups) {
    let runStart = g.start;
    for (let k = g.start + 1; k <= g.start + g.count; k++) {
      if (k < g.start + g.count && t.cells[order[k]] === t.cells[order[runStart]]) continue;
      const count = k - runStart;
      const seg: VisibleGroup = { name: (multi ? g.name + " · " : "") + nameOf(t.cells[order[runStart]]), start: runStart, count, patients: count };
      if (withPct) seg.pct = data.tracks.map((tr) => {
        if (tr.kind !== "gene" && tr.kind !== "derivedEvent") return null;
        let alt = 0, prof = 0;
        for (let i = runStart; i < k; i++) { const c = tr.cells[order[i]]; if (c !== -1) prof++; if (c > 0) alt++; }
        return prof ? 100 * alt / prof : null;
      });
      out.push(seg);
      runStart = k;
    }
  }
  return out;
}
/** the drawing plus breathing room under the last track */
export function canvasHeight(nTracks: number): number { return GEOM.header + nTracks * (GEOM.rowH + GEOM.rowGap) + GEOM.footer; }

export function numericColor(t: { center?: number | null }, v: number): string { return styleNumericColor(v, t.center, STYLE); }

type TrackLike = UnpackedContract["tracks"][number];

/** Aggregate cells[order[k0..k1)] into one display code (shared level-of-detail rule). */
export function aggregate(t: TrackLike, order: Uint32Array, k0: number, k1: number, scratch: Int32Array): number {
  return lodAggregate(t, t.cells, order, k0, k1, scratch);
}

function drawCell(ctx: CanvasRenderingContext2D, t: TrackLike, code: number, x: number, y: number, w: number, h: number, P: Palette,
  S: Style, colors?: Record<string, Record<string, string>>): void {
  if (t.kind === "gene") {
    for (const l of cellLayers(code, S)) {
      if (l.alpha < 1) ctx.globalAlpha = l.alpha;
      if (l.stroke) {
        const sw = Math.min(l.stroke, w / 2 || l.stroke);
        ctx.strokeStyle = l.color; ctx.lineWidth = sw;
        ctx.strokeRect(x + sw / 2, y + sw / 2, Math.max(0, w - sw), h - sw);
      } else { ctx.fillStyle = l.color; ctx.fillRect(x, y + h * l.band[0], w, h * (l.band[1] - l.band[0])); }
      if (l.alpha < 1) ctx.globalAlpha = 1;
    }
    return;
  }
  if (t.kind === "derivedEvent") { ctx.fillStyle = code > 0 ? P.derived : P.unaltered; ctx.fillRect(x, y, w, h); return; }
  if (t.numeric) { ctx.fillStyle = code === -1 ? P.np : styleNumericColor(code, t.center, S); ctx.fillRect(x, y, w, h); return; }
  ctx.fillStyle = code === -1 ? P.np : trackCategoryColor(t, code, S, colors); ctx.fillRect(x, y, w, h);
}

/** The palette a contract draws with: defaults, or its own `display.style` override. */
export function paletteOf(S: Style): Palette {
  return { paper: S.palette.paper, unaltered: S.palette.unaltered, np: S.glyph.notProfiled.fill, npStripe: S.glyph.notProfiled.stripe.color,
    derived: S.palette.derived, text: S.palette.text, muted: S.palette.muted, groupLine: S.palette.groupLine };
}

export interface DrawResult { ms: number; cellsDrawn: number; bucketsDrawn: number }

export interface DrawOpts { gap?: Gap; pctLabels?: boolean; style?: Style; colors?: Record<string, Record<string, string>> }

export function draw(ctx: CanvasRenderingContext2D, data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[],
  view: View, cssW: number, P: Palette = PALETTE, opts: DrawOpts = {}): DrawResult {
  const S = opts.style ?? resolveStyle(data.display?.style);
  const colors = opts.colors ?? data.display?.colors;
  const gap = opts.gap ?? GEOM.groupGap;
  const gapPx = gapOf(gap).px;
  const pctLeft = typeof gap === "object" && gap.edge === "left";
  const t0 = performance.now();
  const { header, rowH, rowGap, gutter } = GEOM;
  const plotW = Math.max(0, cssW - gutter);
  const H = canvasHeight(data.tracks.length);
  ctx.fillStyle = P.paper; ctx.fillRect(0, 0, cssW, H);
  ctx.font = "11px 'IBM Plex Sans', Helvetica, Arial, sans-serif";
  ctx.textBaseline = "alphabetic";
  const zoom = view.zoom, sx = view.scrollX;
  const offs = groupOffsets(groups, zoom, gap);
  const pad = view.whitespace && zoom >= STYLE.geometry.padMinZoom ? Math.min(STYLE.geometry.cellPadMax, Math.floor(zoom * STYLE.geometry.padFraction)) : 0;
  let cellsDrawn = 0, bucketsDrawn = 0;
  const scratch = new Int32Array(64);

  // clip the plot area so partially visible edge columns never bleed into the gutter
  ctx.save();
  ctx.beginPath(); ctx.rect(gutter, 0, plotW, H); ctx.clip();
  groups.forEach((g, gi) => {
    const gx = offs[gi];
    const gEnd = gx + g.count * zoom;
    if (gEnd + gapPx < sx || gx - gapPx > sx + plotW) return;
    const k0 = Math.max(0, Math.floor((sx - gx) / zoom));
    const k1 = Math.min(g.count, Math.ceil((sx + plotW - gx) / zoom));
    // group header, clipped to the group's width when groups are runs of a category
    const gw = g.count * zoom;
    ctx.fillStyle = P.muted;
    if (gw >= 24) ctx.fillText(g.name + (gw >= 90 ? " (" + g.patients.toLocaleString("en-US") + ")" : ""), Math.max(gutter, gx - sx + gutter), 13, Math.max(20, gw + gapPx - 4));
    data.tracks.forEach((t, ti) => {
      const y = header + ti * (rowH + rowGap);
      if (opts.pctLabels && g.pct && g.pct[ti] != null) {
        ctx.fillStyle = P.muted; ctx.font = "10px 'IBM Plex Sans', Helvetica, Arial, sans-serif";
        if (pctLeft) { ctx.textAlign = "right"; ctx.fillText(formatPct(g.pct[ti]), gx - sx + gutter - 3, y + 14, gapPx - 4); ctx.textAlign = "left"; }
        else ctx.fillText(formatPct(g.pct[ti]), gEnd - sx + gutter + 3, y + 14, gapPx - 4);
        ctx.font = "11px 'IBM Plex Sans', Helvetica, Arial, sans-serif";
      }
      if (zoom >= 1) {
        for (let k = k0; k < k1; k++) {
          const x = gx + k * zoom - sx + gutter;
          drawCell(ctx, t, t.cells[order[g.start + k]], x, y, Math.max(0.5, zoom - pad), rowH, P, S, colors);
          cellsDrawn++;
        }
      } else {
        // one bucket per screen pixel across the visible part of the group
        const px0 = Math.floor(gx + k0 * zoom - sx), px1 = Math.ceil(gx + k1 * zoom - sx);
        for (let px = px0; px < px1; px++) {
          const kk0 = Math.max(k0, Math.floor((px + sx - gx) / zoom));
          const kk1 = Math.min(k1, Math.max(kk0 + 1, Math.floor((px + 1 + sx - gx) / zoom)));
          if (kk0 >= kk1) continue;
          const code = aggregate(t, order, g.start + kk0, g.start + kk1, scratch);
          drawCell(ctx, t, code, px + gutter, y, 1, rowH, P, S, colors);
          bucketsDrawn++;
        }
      }
    });
  });
  ctx.restore();

  // gutter: labels and frequencies (drawn last so they sit over any bleed)
  ctx.fillStyle = P.paper; ctx.fillRect(0, 0, gutter, H);
  data.tracks.forEach((t, ti) => {
    const y = header + ti * (rowH + rowGap);
    ctx.fillStyle = P.text; ctx.textAlign = "left";
    ctx.fillText(trackLabelText(t, S), 4, y + 14);
    if (t.freqPct != null) {
      ctx.fillStyle = P.muted; ctx.textAlign = "right";
      ctx.fillText(formatGutterPct(t.driverPct, t.freqPct, t.profiled, data.n), gutter - 8, y + 14);
      ctx.textAlign = "left";
    }
  });
  return { ms: performance.now() - t0, cellsDrawn, bucketsDrawn };
}

export interface Hit { ti: number; gi: number; k: number; ci: number; k1: number; n: number }

/** Map a canvas-space point to (track, group, column or bucket). */
export function hitTest(x: number, y: number, data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[], view: View, gap: Gap = GEOM.groupGap): Hit | null {
  const { header, rowH, rowGap, gutter } = GEOM;
  const ti = Math.floor((y - header) / (rowH + rowGap));
  if (ti < 0 || ti >= data.tracks.length || y - header - ti * (rowH + rowGap) > rowH) return null;
  if (x < gutter) return null;
  const vx = x - gutter + view.scrollX;
  const offs = groupOffsets(groups, view.zoom, gap);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi], gx = offs[gi];
    if (vx < gx || vx >= gx + g.count * view.zoom) continue;
    if (view.zoom >= 1) {
      const k = Math.min(g.count - 1, Math.floor((vx - gx) / view.zoom));
      return { ti, gi, k: g.start + k, k1: g.start + k + 1, ci: order[g.start + k], n: 1 };
    }
    const px = Math.floor(vx - gx);
    const kk0 = Math.floor(px / view.zoom), kk1 = Math.min(g.count, Math.max(kk0 + 1, Math.floor((px + 1) / view.zoom)));
    return { ti, gi, k: g.start + kk0, k1: g.start + kk1, ci: order[g.start + kk0], n: kk1 - kk0 };
  }
  return null;
}

export function decodeGene(code: number): string {
  if (code === -1) return "not profiled";
  if (code === 0) return "no alteration";
  const B = BITS as Record<string, number>;
  const parts: string[] = [];
  for (const m of STYLE.glyph.mutation.priority) if (code & B[m.bit]) parts.push(m.label.toLowerCase());
  if (code & BITS.SV) parts.push(STYLE.glyph.sv.label.toLowerCase());
  for (const o of STYLE.glyph.cna.options) if (code & B[o.bit]) parts.push(o.label.toLowerCase());
  for (const o of STYLE.glyph.mrna.options) if (code & B[o.bit]) parts.push(o.label.toLowerCase());
  for (const o of STYLE.glyph.protein.options) if (code & B[o.bit]) parts.push(o.label.toLowerCase());
  const ALT = BITS.MISSENSE | BITS.TRUNCATING | BITS.INFRAME | BITS.SPLICE | BITS.OTHER_MUT | BITS.PROMOTER | BITS.SV | BITS.AMP | BITS.HOMDEL;
  if (code & ALT) parts.push(code & BITS.DRIVER ? "putative driver" : "unknown significance");
  return parts.join(" · ");
}

/** Rank byte per (gene, column): 0 = unaltered; higher draws earlier. Same ranking as the engine. */
function staircaseRanks(data: UnpackedContract): Uint8Array[] {
  return data.tracks.filter((t) => t.kind === "gene").map((t) => {
    const r = new Uint8Array(data.n);
    const c = t.cells;
    for (let i = 0; i < data.n; i++) {
      const v = c[i];
      if (v <= 0) { r[i] = 0; continue; }
      const type = v & BITS.AMP ? 8 : v & BITS.HOMDEL ? 7 : v & BITS.SV ? 6 : v & BITS.TRUNCATING ? 5 :
        v & BITS.INFRAME ? 4 : v & BITS.SPLICE ? 3 : v & BITS.MISSENSE ? 2 : 1;
      r[i] = type * 2 + (v & BITS.DRIVER ? 1 : 0);
    }
    return r;
  });
}

export interface SortKey { track: string; dir: "asc" | "desc" }

/**
 * Re-order columns within each group by the given keys — a track label ("asc"/"desc",
 * missing values last), "genomic" (staircase) or "id" (patient id) — with the staircase
 * and patient id as the final tiebreakers, exactly like the engine.
 */
export function sortColumns(data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[], keys: SortKey[]): Uint32Array {
  const ranks = staircaseRanks(data);
  const ids = data.columns();
  const genomic = (a: number, b: number): number => { for (const r of ranks) { const d = r[b] - r[a]; if (d) return d; } return 0; };
  const byId = (a: number, b: number): number => (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0);
  const cmps = keys.map((k): ((a: number, b: number) => number) => {
    const sign = k.dir === "desc" ? -1 : 1;
    if (k.track === "genomic") return (a, b) => sign * genomic(a, b);
    if (k.track === "id") return (a, b) => sign * byId(a, b);
    const t = data.tracks.find((x) => x.label === k.track);
    if (!t) throw new Error("sort: no track labelled '" + k.track + "'");
    const c = t.cells;
    return (a, b) => { const x = c[a], y = c[b]; if (x === y) return 0; if (x === -1) return 1; if (y === -1) return -1; return sign * (x - y); };
  });
  cmps.push(genomic, byId);
  const out = new Uint32Array(order.length);
  for (const g of groups) {
    const idx = Array.from(order.subarray(g.start, g.start + g.count));
    idx.sort((a, b) => { for (const c of cmps) { const r = c(a, b); if (r) return r; } return 0; });
    out.set(idx, g.start);
  }
  return out;
}
