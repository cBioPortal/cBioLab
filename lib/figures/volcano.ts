// `volcano` is THE volcano: alteration enrichment, generic assays and differential expression all
// draw through it, so its axes, its density layer and its label placement are one implementation.
import {
  label, textWidth, wrapWidth, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, fmtInt, esc, FS, SW, OTHER
} from "../svg-kit.ts";
import { placeLabels, type LabelWant } from "../chart/place.ts";
import type { Pal } from "./common.ts";

/** every tested item not drawn as a point, binned on the volcano's axes: [x bin, y bin, count, class?] */
export interface VolcanoGrid { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number, ...number[]][] }
export interface VolcanoPoint { key: string; label?: string; x: number; p: number; color: string; tip?: string }

/** "3 of 25 named genes …" — what the volcano could not label, for its caption */
export function unplacedNote(unplaced: string[], total: number, noun: string): string {
  if (!unplaced.length) return "";
  return fmtInt(unplaced.length) + " of " + fmtInt(total) + " " + noun + " named on this volcano could not be labelled without " +
    "overprinting another label or point and " + (unplaced.length === 1 ? "is" : "are") + " left unlabelled: " + unplaced.join(", ") + ".";
}

// ---- the volcano -------------------------------------------------------------------------------

const PAD = 5;
/** room left of a panel's left axis title */
const EDGE = 6;

/**
 * A volcano at (x0, y0), `width` wide, its plot `plotH` tall: the reported items as dots, every
 * other tested item as a density grid behind them, the `labels` named where they fit. x is clamped
 * to ±xMax (an infinite ratio sits on the edge), −log₁₀ p to yMax. `sides` names the cohort each
 * side favours: [right, left]. Returns the drawing, its height and the labels it could not place.
 */
export function volcano(p: Pal, o: {
  x0: number; y0: number; width: number; plotH: number; grid: VolcanoGrid; pts: VolcanoPoint[]; labels: string[];
  xTitle: string; sides?: [string, string]; r?: number; cellColor?: (cls: number) => string; noun?: string;
}): { svg: string; height: number; unplaced: string[] } {
  const g = o.grid, r = o.r ?? 2.6;
  const T = o.y0 + FS.small;
  const yTitle = "−log₁₀ p";
  const ys = linear(0, g.yMax, T + o.plotH - PAD, T + PAD, { nice: false });
  const L = o.x0 + EDGE + leftAxisWidth(ys, yTitle), R = o.x0 + o.width - 6;
  const xs = linear(-g.xMax, g.xMax, L + PAD, R - PAD, { nice: false });
  const B = T + o.plotH;
  const X = (x: number) => xs(Math.max(-g.xMax, Math.min(g.xMax, x)));
  const Y = (lp: number) => ys(Math.min(g.yMax, Math.max(0, lp)));
  const lp = (pv: number) => -Math.log10(Math.max(1e-300, pv));
  const out: string[] = [];
  out.push(`<rect x="${L}" y="${T}" width="${r1(R - L)}" height="${o.plotH}" fill="none" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R }));
  out.push(axisBottom(xs, B, p, { title: o.xTitle, minX: o.x0, maxX: o.x0 + o.width, gridTo: T }));
  out.push(`<line x1="${r1(xs(0))}" y1="${T}" x2="${r1(xs(0))}" y2="${B}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  // the density of everything not drawn as a point
  const cw = (xs(g.xMax) - xs(-g.xMax)) / g.nx, ch = (ys(0) - ys(g.yMax)) / g.ny;
  const maxC = Math.max(1, ...g.cells.map((c) => c[2]));
  let dens = "";
  for (const c of g.cells) {
    const [bx, by, n] = c;
    const col = o.cellColor ? o.cellColor(c[3] ?? 0) : OTHER;
    dens += `<rect x="${r1(xs(-g.xMax) + bx * cw)}" y="${r1(ys(0) - (by + 1) * ch)}" width="${r1(cw + 0.3)}" height="${r1(ch + 0.3)}" fill="${col}" opacity="${r2(0.15 + 0.6 * Math.log1p(n) / Math.log1p(maxC))}"/>`;
  }
  out.push(dens);
  const at = o.pts.map((d) => ({ d, x: X(d.x), y: Y(lp(d.p)) }));
  out.push(at.map(({ d, x, y }) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${d.color}" opacity="0.8">` +
    (d.tip ? `<title>${esc(d.tip)}</title>` : "") + `</circle>`).join(""));
  // the named ones: ringed, labelled where a label fits
  const byKey = new Map(at.map((a) => [a.d.key, a]));
  const wants: LabelWant[] = [];
  const missing: string[] = [];
  for (const key of o.labels) {
    const a = byKey.get(key);
    if (!a) { missing.push(key); continue; }
    const text = a.d.label || key;
    wants.push({ text, px: a.x, py: a.y, w: textWidth(text, FS.small) + 2, h: FS.small + 2 });
    out.push(`<circle cx="${r1(a.x)}" cy="${r1(a.y)}" r="${r + 1.2}" fill="none" stroke="${p.ink}" stroke-width="${SW.line}"/>`);
  }
  const pl = placeLabels(wants, { x: L + 1, y: T + 1, w: R - L - 2, h: o.plotH - 2 }, at, r);
  for (const q of pl.placed) {
    if (q.leader) out.push(`<line x1="${r1(q.leader.x1)}" y1="${r1(q.leader.y1)}" x2="${r1(q.leader.x2)}" y2="${r1(q.leader.y2)}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
    out.push(label(q.box.x + 1, q.box.y + FS.small * 0.85, q.text, { size: FS.small, fill: p.ink,
      extra: `stroke="${p.bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` }));
  }
  let y = B + bottomAxisHeight(o.xTitle);
  // which side is which, as the portal marks them: "← lower group · higher group →"
  if (o.sides) {
    const half = (R - L) / 2 - 6;
    y += FS.small + 4;
    out.push(label(L, y, "← " + o.sides[1], { size: FS.small, fill: p.muted, maxW: half }));
    out.push(label(R, y, o.sides[0] + " →", { size: FS.small, fill: p.muted, anchor: "end", maxW: half }));
  }
  const unplaced = [...pl.unplaced, ...missing];
  const note = unplacedNote(unplaced, o.labels.length, o.noun || "genes");
  if (note) {
    const lines = wrapWidth(note, o.width - 8, FS.small);
    lines.forEach((l, i) => out.push(label(o.x0 + 4, y + 4 + (i + 1) * Math.round(FS.small * 1.35), l, { size: FS.small, fill: p.muted })));
    y += 4 + lines.length * Math.round(FS.small * 1.35);
  }
  return { svg: out.join(""), height: y + 4 - o.y0, unplaced };
}

/** a volcano panel's plot height for its width: about square, neither a strip nor a tower */
export const volcanoPlotH = (w: number) => Math.round(Math.max(220, Math.min(380, w * 0.72)));

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
