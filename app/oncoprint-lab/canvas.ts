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

export const BITS = { MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16, SV: 32, AMP: 64, HOMDEL: 128, DRIVER: 256 };
export const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"];
export const PALETTE = {
  paper: "#ffffff", unaltered: "#e8ecee", np: "#f4f6f7", npStripe: "#dfe4e7",
  amp: "#e41a1c", homdel: "#2166ac", sv: "#8e24aa",
  missense: "#2e7d32", truncating: "#111111", inframe: "#b8860b", splice: "#ff8c00", otherMut: "#9467bd",
  derived: "#0f86a1", text: "#1f2933", muted: "#5b6b76", groupLine: "#c9d2d8"
};
export type Palette = typeof PALETTE;

export const GEOM = { header: 22, rowH: 20, rowGap: 3, gutter: 168, groupGap: 10 };

export interface VisibleGroup { name: string; start: number; count: number; patients: number }
export interface View { zoom: number; scrollX: number; whitespace: boolean }
export type Cells = Int16Array | Int32Array;

/** Virtual x (px, before scroll) where each group's first column starts. */
export function groupOffsets(groups: VisibleGroup[], zoom: number): number[] {
  const out: number[] = []; let x = 0;
  for (const g of groups) { out.push(x); x += g.count * zoom + GEOM.groupGap; }
  return out;
}
export function virtualWidth(groups: VisibleGroup[], zoom: number): number {
  return groups.reduce((w, g) => w + g.count * zoom, 0) + Math.max(0, groups.length - 1) * GEOM.groupGap;
}
export function fitZoom(groups: VisibleGroup[], plotW: number): number {
  const n = groups.reduce((s, g) => s + g.count, 0);
  const gaps = Math.max(0, groups.length - 1) * GEOM.groupGap;
  return n ? Math.max(1e-6, (plotW - gaps) / n) : 1;
}
export function canvasHeight(nTracks: number): number { return GEOM.header + nTracks * (GEOM.rowH + GEOM.rowGap); }

function mutColor(code: number, P: Palette): string | null {
  if (code & BITS.MISSENSE) return P.missense;
  if (code & BITS.TRUNCATING) return P.truncating;
  if (code & BITS.INFRAME) return P.inframe;
  if (code & BITS.SPLICE) return P.splice;
  if (code & BITS.OTHER_MUT) return P.otherMut;
  return null;
}
function heat(v: number): string {
  const t = Math.max(0, Math.min(1, v / 255)), mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return "rgb(" + mix(222, 8) + "," + mix(235, 72) + "," + mix(247, 135) + ")";
}
function diverging(v: number, c: number): string {
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  if (v <= c) { const t = c ? v / c : 1; return "rgb(" + lerp(33, 255, t) + "," + lerp(102, 255, t) + "," + lerp(172, 255, t) + ")"; }
  const t = (v - c) / (255 - c || 1);
  return "rgb(" + lerp(255, 178, t) + "," + lerp(255, 24, t) + "," + lerp(255, 43, t) + ")";
}
export function numericColor(t: { center?: number | null }, v: number): string { return t.center != null ? diverging(v, t.center) : heat(v); }

type TrackLike = UnpackedContract["tracks"][number];

/** Aggregate cells[order[k0..k1)] into one display code, per track kind. */
export function aggregate(t: TrackLike, order: Uint32Array, k0: number, k1: number, scratch: Int32Array): number {
  const cells = t.cells;
  if (t.numeric) {
    let sum = 0, n = 0;
    for (let k = k0; k < k1; k++) { const c = cells[order[k]]; if (c !== -1) { sum += c; n++; } }
    return n ? Math.round(sum / n) : -1;
  }
  if (t.kind === "clinical" && t.categories) {
    const m = t.categories.length + 1; // + Other
    for (let i = 0; i < m; i++) scratch[i] = 0;
    let saw = false;
    for (let k = k0; k < k1; k++) { const c = cells[order[k]]; if (c >= 0 && c < m) { scratch[c]++; saw = true; } }
    if (!saw) return -1;
    let best = 0; for (let i = 1; i < m; i++) if (scratch[i] > scratch[best]) best = i;
    return best;
  }
  let code = -1;
  for (let k = k0; k < k1; k++) { const c = cells[order[k]]; if (c === -1) continue; code = (code === -1 ? 0 : code) | (c > 0 ? c : 0); }
  return code;
}

function drawCell(ctx: CanvasRenderingContext2D, t: TrackLike, code: number, x: number, y: number, w: number, h: number, P: Palette): void {
  if (t.kind === "gene") {
    if (code === -1) {
      ctx.fillStyle = P.np; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = P.npStripe; ctx.fillRect(x, y + h * 0.45, w, h * 0.1);
      return;
    }
    ctx.fillStyle = P.unaltered; ctx.fillRect(x, y, w, h);
    if (code <= 0) return;
    const vus = !(code & BITS.DRIVER);
    if (vus) ctx.globalAlpha = 0.35;
    if (code & BITS.AMP) { ctx.fillStyle = P.amp; ctx.fillRect(x, y, w, h); }
    else if (code & BITS.HOMDEL) { ctx.fillStyle = P.homdel; ctx.fillRect(x, y, w, h); }
    if (code & BITS.SV) { ctx.fillStyle = P.sv; ctx.fillRect(x, y + h * 0.15, w, h * 0.7); }
    const mc = mutColor(code, P);
    if (mc) { ctx.fillStyle = mc; ctx.fillRect(x, y + h * 0.3, w, h * 0.4); }
    if (vus) ctx.globalAlpha = 1;
    return;
  }
  if (t.kind === "derivedEvent") { ctx.fillStyle = code > 0 ? P.derived : P.unaltered; ctx.fillRect(x, y, w, h); return; }
  if (t.numeric) { ctx.fillStyle = code === -1 ? P.np : numericColor(t, code); ctx.fillRect(x, y, w, h); return; }
  ctx.fillStyle = code === -1 ? P.np : CAT_COLORS[code % CAT_COLORS.length]; ctx.fillRect(x, y, w, h);
}

export interface DrawResult { ms: number; cellsDrawn: number; bucketsDrawn: number }

export function draw(ctx: CanvasRenderingContext2D, data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[],
  view: View, cssW: number, P: Palette = PALETTE): DrawResult {
  const t0 = performance.now();
  const { header, rowH, rowGap, gutter } = GEOM;
  const plotW = Math.max(0, cssW - gutter);
  const H = canvasHeight(data.tracks.length);
  ctx.fillStyle = P.paper; ctx.fillRect(0, 0, cssW, H);
  ctx.font = "11px 'IBM Plex Sans', Helvetica, Arial, sans-serif";
  ctx.textBaseline = "alphabetic";
  const zoom = view.zoom, sx = view.scrollX;
  const offs = groupOffsets(groups, zoom);
  const pad = view.whitespace && zoom >= 3 ? Math.min(3, Math.floor(zoom * 0.3)) : 0;
  let cellsDrawn = 0, bucketsDrawn = 0;
  const scratch = new Int32Array(64);

  // clip the plot area so partially visible edge columns never bleed into the gutter
  ctx.save();
  ctx.beginPath(); ctx.rect(gutter, 0, plotW, H); ctx.clip();
  groups.forEach((g, gi) => {
    const gx = offs[gi];
    const gEnd = gx + g.count * zoom;
    if (gEnd < sx || gx > sx + plotW) return;
    const k0 = Math.max(0, Math.floor((sx - gx) / zoom));
    const k1 = Math.min(g.count, Math.ceil((sx + plotW - gx) / zoom));
    // group header
    ctx.fillStyle = P.muted;
    ctx.fillText(g.name + " (" + g.patients.toLocaleString("en-US") + ")", Math.max(gutter, gx - sx + gutter), 13);
    data.tracks.forEach((t, ti) => {
      const y = header + ti * (rowH + rowGap);
      if (zoom >= 1) {
        for (let k = k0; k < k1; k++) {
          const x = gx + k * zoom - sx + gutter;
          drawCell(ctx, t, t.cells[order[g.start + k]], x, y, Math.max(0.5, zoom - pad), rowH, P);
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
          drawCell(ctx, t, code, px + gutter, y, 1, rowH, P);
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
    const label = t.label.length > 17 ? t.label.slice(0, 16) + "…" : t.label;
    ctx.fillText(label, 4, y + 14);
    if (t.freqPct != null) {
      ctx.fillStyle = P.muted; ctx.textAlign = "right";
      ctx.fillText(t.driverPct != null ? t.driverPct + "% / " + t.freqPct + "%" : t.freqPct + "%", gutter - 8, y + 14);
      ctx.textAlign = "left";
    }
  });
  return { ms: performance.now() - t0, cellsDrawn, bucketsDrawn };
}

export interface Hit { ti: number; gi: number; k: number; ci: number; k1: number; n: number }

/** Map a canvas-space point to (track, group, column or bucket). */
export function hitTest(x: number, y: number, data: UnpackedContract, order: Uint32Array, groups: VisibleGroup[], view: View): Hit | null {
  const { header, rowH, rowGap, gutter } = GEOM;
  const ti = Math.floor((y - header) / (rowH + rowGap));
  if (ti < 0 || ti >= data.tracks.length || y - header - ti * (rowH + rowGap) > rowH) return null;
  if (x < gutter) return null;
  const vx = x - gutter + view.scrollX;
  const offs = groupOffsets(groups, view.zoom);
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
  const parts: string[] = [];
  if (code & BITS.MISSENSE) parts.push("missense");
  if (code & BITS.TRUNCATING) parts.push("truncating");
  if (code & BITS.INFRAME) parts.push("in-frame");
  if (code & BITS.SPLICE) parts.push("splice");
  if (code & BITS.OTHER_MUT) parts.push("other mutation");
  if (code & BITS.SV) parts.push("structural variant");
  if (code & BITS.AMP) parts.push("amplification");
  if (code & BITS.HOMDEL) parts.push("deep deletion");
  parts.push(code & BITS.DRIVER ? "putative driver" : "unknown significance");
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
