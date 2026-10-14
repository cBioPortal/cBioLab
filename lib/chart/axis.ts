// Axes laid out from measured labels: the left margin is what the widest tick label and the title
// need, end ticks stay inside the figure, labels that would collide are thinned (never overprinted),
// and a category axis turns its labels only when they do not fit flat.
import type { Scale } from "./scale.ts";
import { textWidth, label } from "./text.ts";
import { FS, SW } from "./style.ts";

export interface AxisPal { ink: string; muted: string; line: string }

const TICK_GAP = 6;
const TITLE_GAP = 6;

/** the room a left axis needs: its widest tick label, the gap, and its title turned on its side */
export function leftAxisWidth(s: Scale, title?: string, fmt = s.fmt): number {
  const w = Math.max(0, ...s.ticks.map((t) => textWidth(fmt(t), FS.small)));
  return Math.ceil(w + TICK_GAP + (title ? FS.body + TITLE_GAP : 0) + 4);
}

/** the height a bottom axis needs below its line */
export const bottomAxisHeight = (title?: string): number => TICK_GAP + FS.small + 2 + (title ? TITLE_GAP + FS.body : 0) + 2;

/**
 * A value axis on the left at `x`, gridlines across to `gridTo` when given. The title runs up the
 * left edge of the room `leftAxisWidth` reserved.
 */
export function axisLeft(s: Scale, x: number, pal: AxisPal, o: { title?: string; gridTo?: number; fmt?: (v: number) => string; line?: boolean } = {}): string {
  const fmt = o.fmt || s.fmt;
  const out: string[] = [];
  for (const t of s.ticks) {
    const y = s(t);
    if (o.gridTo != null) out.push(`<line x1="${x}" y1="${r1(y)}" x2="${o.gridTo}" y2="${r1(y)}" stroke="${pal.line}" stroke-width="${SW.hair}"/>`);
    out.push(label(x - TICK_GAP, y + FS.small * 0.35, fmt(t), { size: FS.small, fill: pal.muted, anchor: "end" }));
  }
  if (o.line) out.push(`<line x1="${x}" y1="${s.range[0]}" x2="${x}" y2="${s.range[1]}" stroke="${pal.muted}" stroke-width="${SW.line}"/>`);
  if (o.title) {
    const w = leftAxisWidth(s, o.title, fmt);
    const tx = x - w + FS.body * 0.8, ty = (s.range[0] + s.range[1]) / 2;
    out.push(label(tx, ty, o.title, { size: FS.body, fill: pal.ink, anchor: "middle", rotate: -90, maxW: Math.abs(s.range[0] - s.range[1]) }));
  }
  return out.join("");
}

/**
 * A value axis below the plot, its line at `y`. Labels are centred on their ticks except where that
 * would cross [minX, maxX] (the figure's edges), where they are pulled in; labels that would touch
 * are thinned to every second (third, …) tick.
 */
export function axisBottom(s: Scale, y: number, pal: AxisPal, o: { title?: string; gridTo?: number; fmt?: (v: number) => string; minX?: number; maxX?: number; line?: boolean } = {}): string {
  const fmt = o.fmt || s.fmt;
  const minX = o.minX ?? 0, maxX = o.maxX ?? Infinity;
  const ticks = s.ticks;
  const placed = ticks.map((t) => {
    const text = fmt(t), w = textWidth(text, FS.small), cx = s(t);
    const left = Math.min(Math.max(cx - w / 2, minX), maxX - w);
    return { t, text, w, cx, left };
  });
  let every = 1;
  const collides = (k: number) => {
    let prev = -Infinity;
    for (let i = 0; i < placed.length; i += k) {
      if (placed[i].left < prev + 6) return true;
      prev = placed[i].left + placed[i].w;
    }
    return false;
  };
  while (every < placed.length && collides(every)) every++;
  const out: string[] = [];
  placed.forEach((p, i) => {
    if (o.gridTo != null) out.push(`<line x1="${r1(p.cx)}" y1="${o.gridTo}" x2="${r1(p.cx)}" y2="${y}" stroke="${pal.line}" stroke-width="${SW.hair}"/>`);
    out.push(`<line x1="${r1(p.cx)}" y1="${y}" x2="${r1(p.cx)}" y2="${y + 3}" stroke="${pal.muted}" stroke-width="${SW.line}"/>`);
    if (i % every === 0) out.push(label(p.left, y + TICK_GAP + FS.small, p.text, { size: FS.small, fill: pal.muted }));
  });
  if (o.line !== false) out.push(`<line x1="${s.range[0]}" y1="${y}" x2="${s.range[1]}" y2="${y}" stroke="${pal.muted}" stroke-width="${SW.line}"/>`);
  if (o.title) {
    const ty = y + TICK_GAP + FS.small + 2 + TITLE_GAP + FS.body;
    out.push(label((s.range[0] + s.range[1]) / 2, ty, o.title, { size: FS.body, fill: pal.ink, anchor: "middle", maxW: Math.abs(s.range[1] - s.range[0]) }));
  }
  return out.join("");
}

/**
 * Category labels under bands centred at `centers`, each band `band` wide. Flat when every label
 * fits its band; otherwise turned 45° (90° when bands are narrower than a line of text) and cut to
 * `maxH`. Returns the drawing and the height it takes below `y`.
 */
export function bandLabels(labels: string[], centers: number[], band: number, y: number, pal: AxisPal,
  o: { maxH?: number; size?: number; minX?: number } = {}): { svg: string; height: number } {
  const size = o.size ?? FS.small, maxH = o.maxH ?? 110, minX = o.minX ?? 0;
  const widths = labels.map((l) => textWidth(l, size));
  const widest = Math.max(0, ...widths);
  if (widest <= band - 4) {
    return { svg: labels.map((l, i) => label(centers[i], y + size + 2, l, { size, fill: pal.ink, anchor: "middle" })).join(""), height: size + 6 };
  }
  const steep = band < size * 1.3;
  const angle = steep ? -90 : -45;
  const sin = steep ? 1 : Math.SQRT1_2;
  const maxW = maxH / sin;
  const used = Math.min(widest, maxW) * sin + size;
  // a turned label runs down and to the left of its band; one near the left edge is cut short
  // rather than run off the figure
  const cos = steep ? 0 : Math.SQRT1_2;
  const svg = labels.map((l, i) => {
    const x = centers[i] + (steep ? size * 0.35 : size * 0.3), yy = y + 6;
    // the turned line's own height reaches a further size·sin past its end
    const room = cos ? Math.min(maxW, (x - minX - size * Math.SQRT1_2) / cos) : maxW;
    return label(x, yy, l, { size, fill: pal.ink, anchor: "end", rotate: angle, maxW: room });
  }).join("");
  return { svg, height: Math.ceil(used + 8) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
