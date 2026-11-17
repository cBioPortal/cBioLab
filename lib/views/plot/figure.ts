// The plot view, from the aggregated contract: a density field for a scatter, boxes for a numeric
// axis grouped by a categorical one, a shaded contingency for two categoricals.
//
// The cells, the quartiles and the coefficients arrive already computed, which is why the same
// picture draws for a hundred cases or four hundred thousand. The only cases drawn one by one are
// the points the engine chose (every case under the cap, the outliers over it), at most POINTS_CAP.
import type { DrawnResultOf } from "../../types.ts";
import type { HighlightPoint, PlotData, PlotLayer } from "../../plot.ts";
import { fromLog, toLog, type LogRule } from "../../plot-log.ts";
import { isAbsent, jitterFor } from "../../plot-draw.ts";
import { LAYER_BASE } from "../../plot-layers.ts";
import {

  esc, palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, bandLabels, legend, label,
  textWidth, fmtInt, fmtNum, FS, SW, SERIES, OTHER, type Scale, type SvgOpts, type LegendItem
} from "../../svg-kit.ts";
import { portalCorr, portalEquation, portalP } from "../../chart/format.ts";

type Pal = ReturnType<typeof palette>;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The radius of every case drawn as a point on a plot — scatter or box, the plotted cohort or a
 * point layer, five points or five thousand — so a dot means the same thing on every figure. Its
 * outline (`halo`) is drawn over the edge, leaving a coloured disc of 2.5.
 */
export const PLOT_POINT_R = 2.8;

/**
 * Every case's dot carries the same thin outline in the figure's background colour, so a dot in a
 * layer and a dot of the plotted cohort are one size, and touching dots stay apart.
 */
const halo = (p: Pal) => `stroke="${p.bg}" stroke-width="0.6"`;
/** a mark's case, which the page's hover (app/lab/plot-hover.tsx) reads to find the point under the pointer;
 *  a box carries its group's place (`data-box`) the same way */
const caseAttr = (id: string) => ` data-id="${esc(id)}"`;

/** a plot's tips are its points' and its boxes', both shown by the page (app/lab/plot-hover.tsx): the figure has none of its own */
const NO_FIGURE_TIP = { tip: false };

/** the plot's height for a figure `w` wide */
const plotHeight = (w: number) => Math.round(Math.max(240, Math.min(420, w * 0.36)));

/** an axis's title: its label, which on a log axis ends as the portal's does, " (log2(value + 1))" or " (log10)" */
export function axisTitle(a: PlotData["x"]): string {
  return a.label;
}

/**
 * A numeric axis over [lo, hi] onto [r0, r1]. A log axis carries its values by its LogRule, so its
 * ticks are placed at round values of v (0, 1, 10, 100 …, with 3s between when there is room; a
 * log10 axis also below 1) and labelled as v, not as the logarithm.
 */
function numScale(lo: number, hi: number, r0: number, r1: number, rule: LogRule | undefined, nice: boolean): Scale {
  const s = linear(lo, hi, r0, r1, { nice: nice && !rule });
  if (!rule) return s;
  const [d0, d1] = s.domain;
  const vals: number[] = rule === "log2" ? [0] : [];
  for (let p = rule === "log2" ? 1 : 1e-6; p <= 1e12; p *= 10) vals.push(p, 3 * p);
  const back = (t: number) => fromLog(rule, t);
  let ticks = vals.map((v) => toLog(rule, v)).filter((t) => t >= d0 - 1e-9 && t <= d1 + 1e-9);
  if (ticks.length > 7) ticks = ticks.filter((t) => { const v = back(t); return Math.abs(v) < 1e-9 || Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-6; });
  s.ticks = ticks;
  s.fmt = (t: number) => { const v = back(t); return fmtNum(Math.round(v * (v < 1 ? 1e6 : 1e3)) / (v < 1 ? 1e6 : 1e3)); };
  return s;
}

export function plotSvg(v: DrawnResultOf<"plot"> | DrawnResultOf<"coexpression">, o: SvgOpts): string {
  const d = v.plot as PlotData | undefined;
  if (!d) return "";
  const p = palette(o.theme), W = Math.max(480, o.width || 960);
  if (d.shape === "scatter" && d.bins && d.extent && d.grid) return scatter(v, d, W, p);
  if (d.shape === "box" && d.groups && d.groups.length) return box(v, d, W, p);
  if (d.shape === "table" && d.cells && d.cells.length) return table(v, d, W, p);
  return "";
}

/** the point layers' key: one dot per layer drawn, what it holds and how many cases */
function layerItems(d: PlotData): LegendItem[] {
  return (d.layers || []).filter((l) => l.shown !== "none")
    .map((l) => ({ label: l.label + " (" + fmtInt(l.n) + ")", color: l.color, kind: "dot" as const }));
}
/** the layers drawn at all, each in its own colour over the plotted cohort's light blue */
const drawnLayers = (d: PlotData) => (d.layers || []).filter((l) => l.shown !== "none");
/**
 * One layer's marks as a group tagged with its place in the view's list, so a page can hide it;
 * `base` is the plotted cohort. A layer's cases an earlier layer drew are hidden groups, one per
 * layer that drew them (`owner`), which the page shows when that owner is hidden.
 */
const layerGroup = (key: number | "base", marks: string[], owner?: number) =>
  marks.length ? `<g data-layer="${key}"${owner != null ? ` data-shared="" data-owner="${owner}" display="none"` : ""}>${marks.join("")}</g>` : "";
/** a layer's shared cases, grouped by the layer that drew each */
function sharedGroups(h: PlotLayer, key: number, mark: (pt: HighlightPoint) => string[]): string {
  const by = new Map<number, string[]>();
  (h.shared || []).forEach((pt, i) => { const o = h.sharedOwners?.[i] ?? 0; (by.get(o) ?? by.set(o, []).get(o)!).push(...mark(pt)); });
  return [...by.entries()].map(([o, marks]) => layerGroup(key, marks, o)).join("");
}

/**
 * How a plot's points take their fill and ring: the key names the commonest categories, and
 * everything past it — and a case with no value — is one grey "other" with a key entry of its own,
 * rather than a colour nobody can look up. A ring means "this case also has that", so absence gets
 * no ring and no key entry. A box's points and density and a scatter's points share it.
 */
function pointColours(d: PlotData, pts: { c?: string; r?: string }[], violin: { c?: string }[] = []) {
  const colorKey = (d.legend || []).filter((k) => !k.ring);
  const ringKey = (d.legend || []).filter((k) => k.ring);
  const byLabel = new Map((d.legend || []).map((k) => [k.label, k.color]));
  const fillKeyed = new Set(colorKey.map((k) => k.label)), ringKeyed = new Set(ringKey.map((k) => k.label));
  const fillOthers = new Set<string>(), ringOthers = new Set<string>();
  let fillNoValue = false;
  for (const b of violin) if (b.c != null && !fillKeyed.has(b.c)) { if (b.c === "") fillNoValue = true; else fillOthers.add(b.c); }
  for (const pt of pts) {
    if (pt.c != null && !fillKeyed.has(pt.c)) { if (pt.c === "") fillNoValue = true; else fillOthers.add(pt.c); }
    if (pt.r != null && !isAbsent(pt.r) && !ringKeyed.has(pt.r)) ringOthers.add(pt.r);
  }
  const fillOf = (lab: string) => fillKeyed.has(lab) ? byLabel.get(lab)! : OTHER;
  const ringOf = (lab: string) => ringKeyed.has(lab) ? byLabel.get(lab)! : OTHER;
  const otherLabel = (n: number, noValue: boolean) =>
    "other (" + [n ? n + " more categor" + (n === 1 ? "y" : "ies") : "", noValue ? "no value" : ""].filter(Boolean).join(", ") + ")";
  const keyItems = (keys: { label: string; color: string }[], ring: boolean): LegendItem[] =>
    keys.map((k) => ({ label: k.label, color: k.color, kind: "dot" as const, ...(ring ? { opacity: 0.6 } : {}) }));
  /** the fill and ring keys, stacked from `y` down; the svg and where they end */
  const legends = (y: number, W: number, p: Pal): { svg: string; y: number } => {
    const out: string[] = [];
    if (colorKey.length) {
      const items = keyItems(colorKey, false);
      if (fillOthers.size || fillNoValue) items.push({ label: otherLabel(fillOthers.size, fillNoValue), color: OTHER, kind: "dot" });
      const lg = legend(items, 8, y, W - 16, p, { title: d.colorLabel || "colour" }); out.push(lg.svg); y += lg.height;
    }
    const rings = ringKey.filter((k) => !isAbsent(k.label));
    if (rings.length) {
      const items = keyItems(rings, true);
      if (ringOthers.size) items.push({ label: otherLabel(ringOthers.size, false), color: OTHER, kind: "dot", opacity: 0.6 });
      const lg = legend(items, 8, y, W - 16, p, { title: (d.ringLabel || "ring") + " (ring)" }); out.push(lg.svg); y += lg.height;
    }
    return { svg: out.join(""), y };
  };
  return { colorKey, ringKey, fillKeyed, fillOf, ringOf, legends };
}

function scatter(v: DrawnResultOf<"plot"> | DrawnResultOf<"coexpression">, d: PlotData, W: number, p: Pal): string {
  const { x0, x1, y0, y1 } = d.extent!, [gx, gy] = d.grid!;
  const hs = drawnLayers(d);
  const base = LAYER_BASE;
  const st = d.stats;
  // as the portal's Plots tab writes them (PLT-SC-2): Spearman first, each to two decimals, its p by toConditionalPrecision
  const corr = (name: string, r: number | null, pv: number | null) => r == null ? "" : name + ": " + portalCorr(r) + (pv != null ? " (p = " + portalP(pv) + ")" : "");
  const statLine = st ? [corr("Spearman", st.spearman, st.pSpearman), corr("Pearson", st.pearson, st.pPearson)].filter(Boolean).join("   ·   ") : "";
  const T = statLine ? 28 : 12, R = 16, PLOT = plotHeight(W);
  const xTitle = axisTitle(d.x), yTitle = axisTitle(d.y);
  // the bins tile the extent exactly, so the scales keep its ends (no rounding outwards)
  const ysProbe = numScale(y0, y1, T + PLOT, T, d.y.log, false);
  const L = 8 + leftAxisWidth(ysProbe, yTitle);
  const xs = numScale(x0, x1, L, W - R, d.x.log, false);
  const ys = numScale(y0, y1, T + PLOT, T, d.y.log, false);
  const plotW = W - R - L;
  const out: string[] = [];
  if (statLine) out.push(label(L, 16, statLine, { size: FS.body, fill: p.ink, maxW: W - L - 8 }));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R }));
  out.push(axisBottom(xs, T + PLOT, p, { title: xTitle, minX: 0, maxX: W, gridTo: T }));

  const maxN = Math.max(1, ...d.bins!.map((b) => b.n));
  const cw = plotW / gx, ch = PLOT / gy;
  // a log ramp, because a linear one hides everything but the mode — said in the caption
  const shade = (n: number) => Math.min(1, 0.18 + 0.82 * Math.log1p(n) / Math.log1p(maxN));
  const cell = (b: { bx: number; by: number }, fill: string, opacity: number) =>
    `<rect x="${r1(L + b.bx * cw)}" y="${r1(T + PLOT - (b.by + 1) * ch)}" width="${r1(Math.max(cw, 0.8))}" ` +
    `height="${r1(Math.max(ch, 0.8))}" fill="${fill}" fill-opacity="${r1(opacity * 100) / 100}"/>`;
  // Cells whose cases are drawn as points are not also shaded: every case, or the sparse
  // cells (at most cellMax cases) an outliers layer stands in for.
  const cellMax = hs.find((l) => l.kind === "outliers" && l.shown === "points")?.cellMax;
  const shaded = d.pointSet?.rule === "all" && d.xyPoints?.length ? []
    : cellMax ? d.bins!.filter((b) => b.n > cellMax) : d.bins!;
  // under point layers the plotted cohort is a floor-raised shade, so its faintest cells still read
  const own = d.xyPoints || [];
  const colours = pointColours(d, own);
  out.push(layerGroup("base", [
    ...shaded.map((b) => cell(b, base, hs.length ? 0.3 + 0.7 * shade(b.n) : shade(b.n))),
    ...own.map((pt) => {
      const fill = pt.c != null && colours.colorKey.length ? colours.fillOf(pt.c) : base;
      const ring = pt.r != null && !isAbsent(pt.r) ? colours.ringOf(pt.r) : null;
      return `<circle${caseAttr(pt.id)} cx="${r1(xs(pt.x))}" cy="${r1(ys(pt.y))}" r="${PLOT_POINT_R}" fill="${fill}" fill-opacity="${pt.c != null ? 0.85 : 0.7}" ` +
        (ring ? `stroke="${ring}" stroke-width="${r1(PLOT_POINT_R * 0.36)}"` : halo(p)) + `/>`;
    })]));
  const dot = (pt: { id: string; x: number; y: number }, color: string) =>
    `<circle${caseAttr(pt.id)} cx="${r1(xs(pt.x))}" cy="${r1(ys(pt.y))}" r="${PLOT_POINT_R}" fill="${color}" fill-opacity="0.9" ${halo(p)}/>`;
  for (const h of hs) {
    const key = d.layers!.indexOf(h);
    // a cohort layer too large to draw as points is cells on the same grid, shaded by its own densest cell
    if (h.shown === "density" && h.bins) {
      const hMax = Math.max(1, ...h.bins.map((b) => b.n));
      out.push(layerGroup(key, h.bins.map((b) => cell(b, h.color, 0.3 + 0.7 * Math.log1p(b.n) / Math.log1p(hMax)))));
    }
    if (h.shown === "points") {
      out.push(layerGroup(key, h.points!.flatMap((pt) => "x" in pt ? [dot(pt, h.color)] : [])));
      out.push(sharedGroups(h, key, (pt) => "x" in pt ? [dot(pt, h.color)] : []));
    }
  }
  // the regression line the view asks for, fitted over every case rather than over what is visible,
  // clipped to the frame: the line its label describes, coefficients rounded as the portal rounds them
  const fit = d.fit, fitColor = hs.length ? p.ink : SERIES[4];
  if (fit && x1 > x0) {
    const yAt = (xv: number) => fit.intercept + fit.slope * xv;
    // the part of the line inside the frame: where it crosses y0 and y1, if it does
    const xAt = (yv: number) => fit.slope ? (yv - fit.intercept) / fit.slope : NaN;
    const ends = [[x0, yAt(x0)], [x1, yAt(x1)], [xAt(y0), y0], [xAt(y1), y1]]
      .filter(([xv, yv]) => xv >= x0 - 1e-12 && xv <= x1 + 1e-12 && yv >= y0 - 1e-12 && yv <= y1 + 1e-12)
      .sort((a, b) => a[0] - b[0]);
    if (ends.length >= 2) {
      const [a, b] = [ends[0], ends[ends.length - 1]];
      out.push(`<line x1="${r1(xs(a[0]))}" y1="${r1(ys(a[1]))}" x2="${r1(xs(b[0]))}" y2="${r1(ys(b[1]))}" ` +
        `stroke="${fitColor}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
    }
  }

  out.push(`<rect x="${L}" y="${T}" width="${r1(plotW)}" height="${PLOT}" fill="none" stroke="${p.line}" stroke-width="${SW.line}"/>`);

  let y = T + PLOT + bottomAxisHeight(xTitle) + 8;
  if (fit) {
    // the line's swatch and label, as the portal's gutter gives them (PLT-SC-3)
    out.push(`<line x1="${L}" y1="${y + FS.body * 0.6}" x2="${L + 18}" y2="${y + FS.body * 0.6}" stroke="${fitColor}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
    out.push(label(L + 24, y + FS.body, portalEquation(fit.slope, fit.intercept) + (fit.r2 != null ? "   R² = " + String(fit.r2) : ""),
      { size: FS.body, fill: p.ink, maxW: W - L - 32 }));
    y += FS.body + 10;
  }
  { const k = colours.legends(y, W, p); out.push(k.svg); y = k.y; }
  const hk = layerItems(d);
  if (hk.length) { const lg = legend(hk, 8, y, W - 16, p, { title: "point layers" }); out.push(lg.svg); y += lg.height + 4; }
  const cap = caption((v.note ? v.note + "  " : "") + (shaded.length
    ? "Darker is more " + (d.n > 1 ? "cases" : "case") + "; the shade is logarithmic." + (own.length ? " Each dot is one case." : "")
    : "Each dot is one case.") +
    (fit ? " The dashed line is the least-squares fit over every case, its slope and intercept rounded to two decimals as cbioportal.org rounds them, R² from those." : ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, "Plot — " + yTitle + " against " + xTitle, NO_FIGURE_TIP);
}

function box(v: DrawnResultOf<"plot"> | DrawnResultOf<"coexpression">, d: PlotData, W0: number, p: Pal): string {
  // Every group is drawn. Past what fits at the requested width the figure widens (and the page
  // scrolls) rather than dropping the smaller groups, whose cases would otherwise be missing from
  // a figure that still claims the full count.
  const gs = d.groups!;
  const hs = drawnLayers(d);
  const base = LAYER_BASE;
  // the categories lie along the horizontal axis when it is the categorical one, else down the
  // side with each box on its side (the portal's PLT-PT-4 and PLT-PT-5)
  const across = d.x.kind !== "num";
  const numAxis = across ? d.y : d.x, catAxis = across ? d.x : d.y;
  const numTitle = axisTitle(numAxis), catTitle = axisTitle(catAxis);
  const T = 12, R = 16, MIN_BW = 22;
  // The axis spans the whiskers and the points beyond them, but reaches at most one whisker
  // span further each way: one TMB of 570 would otherwise flatten every box to a line. A point
  // past that is pinned to the frame's edge as a triangle and counted in the caption.
  const ptVals = [...(d.points || []), ...hs.flatMap((l) => l.points || [])].flatMap((pt) => "v" in pt ? [pt.v] : []);
  const wLo = Math.min(...gs.map((g) => g.loWhisker)), wHi = Math.max(...gs.map((g) => g.hiWhisker));
  const wSpan = Math.max(1e-9, wHi - wLo);
  const lo = Math.max(Math.min(wLo, ...ptVals), wLo - wSpan), hi = Math.min(Math.max(wHi, ...ptVals), wHi + wSpan);
  // the whiskers' own range, padded a little, with round ticks inside it: rounding the ends out
  // would stretch a −1 whisker into an empty band down to −20
  const pad = (hi - lo) * 0.03 || 1;
  // each group's name carries its count, so the two can never be read against different boxes
  const names = gs.map((g) => g.g + " (" + fmtInt(g.n) + ")");
  let W: number, L: number, PLOT: number, labW = 0;
  let vs: Scale;
  if (across) {
    PLOT = plotHeight(W0);
    vs = numScale(lo - pad, hi + pad, T + PLOT, T, numAxis.log, false);
    L = 8 + leftAxisWidth(vs, numTitle);
    W = Math.max(W0, L + R + gs.length * MIN_BW);
  } else {
    W = W0;
    labW = Math.min(W0 * 0.3, Math.max(...names.map((s) => textWidth(s, FS.small))));
    L = 8 + FS.body + 8 + labW + 8;
    PLOT = Math.max(gs.length * MIN_BW, Math.min(plotHeight(W0), gs.length * 64));
    vs = numScale(lo - pad, hi + pad, L, W - R, numAxis.log, false);
  }
  const plotW = W - L - R;
  const [vlo, vhi] = vs.domain;
  const bw = (across ? plotW : PLOT) / gs.length;
  const centre = (i: number) => (across ? L : T) + bw * (i + 0.5);
  // every mark is placed by its category position `c` and its value's pixel `v`, and turned here
  const at = (c: number, vp: number): [number, number] => across ? [c, vp] : [vp, c];
  const lineCV = (c0: number, v0: number, c1: number, v1: number, attrs: string) => {
    const [x1, y1] = at(c0, v0), [x2, y2] = at(c1, v1);
    return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${attrs}/>`;
  };
  /** a rect from c0 to c1 across the category axis and between two value pixels, at least `min` long along it */
  const rectCV = (c0: number, c1: number, v0: number, v1: number, min: number) => {
    const vA = Math.min(v0, v1), len = Math.max(min, Math.abs(v1 - v0));
    const [x, y] = at(c0, vA), [w, h] = across ? [c1 - c0, len] : [len, c1 - c0];
    return `x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"`;
  };
  const dotAt = (c: number, val: number) => { const [x, y] = at(c, vs(val)); return `cx="${r1(x)}" cy="${r1(y)}"`; };
  const out: string[] = [];
  if (across) out.push(axisLeft(vs, L, p, { title: numTitle, gridTo: W - R }));
  else out.push(axisBottom(vs, T + PLOT, p, { title: numTitle, gridTo: T, minX: 0, maxX: W }));

  // the values behind the boxes: every point when the reader may see cases and there are few
  // enough of them, otherwise the density of the same values
  const byGroup = new Map<string, { id: string; v: number; c?: string; r?: string }[]>();
  for (const pt of d.points || [])
    (byGroup.get(pt.g) ?? byGroup.set(pt.g, []).get(pt.g)!).push({ id: pt.id, v: pt.v, c: pt.c, r: pt.r });
  // each violin is scaled to its OWN densest bin: one group holding most of the values would
  // otherwise flatten every other group to a sliver. How many cases a group has is printed with
  // its name, so the width is free to describe its shape.
  const vio = new Map<string, Map<number, Map<string, number>>>();
  const vioMax = new Map<string, number>();
  for (const b of d.violin || []) {
    if (!vio.has(b.g)) vio.set(b.g, new Map());
    const cells = vio.get(b.g)!;
    if (!cells.has(b.b)) cells.set(b.b, new Map());
    const byClass = cells.get(b.b)!;
    byClass.set(b.c ?? "", (byClass.get(b.c ?? "") || 0) + b.n);
    const total = [...byClass.values()].reduce((a, n) => a + n, 0);
    if (total > (vioMax.get(b.g) || 0)) vioMax.set(b.g, total);
  }
  const colours = pointColours(d, d.points || [], d.violin || []);
  const { colorKey, ringKey, fillKeyed, fillOf, ringOf } = colours;
  const vBins = d.violinBins || 40;
  let offScale = 0, ptOffScale = 0;
  /** a value off the axis: a triangle at the frame's edge pointing the way it lies */
  const edgeMark = (id: string, c: number, beyondHi: boolean, r: number, fill: string) => {
    const tip = across ? (beyondHi ? T + 1 : T + PLOT - 1) : (beyondHi ? W - R - 1 : L + 1);
    const out1 = (beyondHi ? 1 : -1) * (across ? -1 : 1), k = r * 1.3, b = tip - out1 * k * 1.6;
    const [ax, ay] = at(c - k, b), [bx, by] = at(c + k, b), [tx, ty] = at(c, tip);
    return `<path${caseAttr(id)} d="M${r1(ax)} ${r1(ay)} L${r1(bx)} ${r1(by)} L${r1(tx)} ${r1(ty)} Z" fill="${fill}" stroke="${p.bg}" stroke-width="0.5"/>`;
  };
  const inAxis = (val: number) => Math.max(vlo, Math.min(vhi, val));
  const categorised = colorKey.length > 0 || ringKey.length > 0;
  // a group of one case has no quartiles to draw (the portal's PLT-BX-3): its value alone
  const singles = gs.filter((g) => g.n < 2).length;

  gs.forEach((g, i) => {
    const cx = centre(i), half = Math.min(24, bw * 0.32);
    // the plotted cohort's violin and points, as one group a page can step back from
    const baseMarks: string[] = [];
    if (d.overlay === "violin" && vio.has(g.g)) {
      const cells = vio.get(g.g)!;
      // a bin stands for a range of VALUES, mapped through the extent the bins were cut over
      const [vx0, vx1] = d.violinExtent || [lo, hi];
      const binW = (vx1 - vx0) / vBins;
      // with the outliers drawn as points, the density stops at this group's whiskers
      const [cLo, cHi] = hs.some((l) => l.kind === "outliers" && l.shown === "points") ? [g.loWhisker, g.hiWhisker] : [vlo, vhi];
      for (const [b, byClass] of cells) {
        const vLo = vx0 + b * binW, vHi = vLo + binW;
        if (vHi < cLo || vLo > cHi) continue;
        const total = [...byClass.values()].reduce((a, n) => a + n, 0);
        const w = half * 1.6 * Math.sqrt(total / (vioMax.get(g.g) || 1));
        const span = (c0: number, c1: number) => rectCV(c0, c1, vs(Math.max(cLo, vLo)), vs(Math.min(cHi, vHi)), 1.2);
        if (!colorKey.length) {
          baseMarks.push(`<rect ${span(cx - w, cx + w)} fill="${base}" fill-opacity="0.28"/>`);
          continue;
        }
        let x = cx - w;
        const segs = colorKey.map((k) => ({ n: byClass.get(k.label) || 0, color: k.color }));
        segs.push({ n: [...byClass.entries()].reduce((a, [c, n]) => fillKeyed.has(c) ? a : a + n, 0), color: OTHER });
        for (const sg of segs) {
          if (!sg.n) continue;
          const seg = 2 * w * (sg.n / total);
          baseMarks.push(`<rect ${span(x, x + seg)} fill="${sg.color}" fill-opacity="0.75"/>`);
          x += seg;
        }
      }
    }
    if (byGroup.has(g.g)) {
      const rBase = PLOT_POINT_R;
      for (const pt of byGroup.get(g.g)!) {
        const fill = pt.c != null && colorKey.length ? fillOf(pt.c) : base;
        const ring = pt.r != null && !isAbsent(pt.r) ? ringOf(pt.r) : null;
        const pc = cx + jitterFor(pt.id) * half * 0.9;
        if (pt.v > vhi || pt.v < vlo) {
          ptOffScale++;
          baseMarks.push(edgeMark(pt.id, pc, pt.v > vhi, rBase, fill));
          continue;
        }
        baseMarks.push(`<circle${caseAttr(pt.id)} ${dotAt(pc, pt.v)} ` +
          `r="${rBase}" fill="${fill}" fill-opacity="0.85" ` +
          (ring ? `stroke="${ring}" stroke-width="${r1(rBase * 0.36)}"` : halo(p)) + `/>`);
      }
    }
    out.push(layerGroup("base", baseMarks));
    const median = (c0: number, c1: number, attrs: string) => lineCV(c0, vs(g.median), c1, vs(g.median), attrs);
    if (g.n >= 2) {
      out.push(lineCV(cx, vs(g.loWhisker), cx, vs(g.hiWhisker), `stroke="${p.muted}" stroke-width="${SW.line}"`));
      out.push(`<rect ${rectCV(cx - half, cx + half, vs(g.q1), vs(g.q3), 1)} ` +
        `fill="${base}" fill-opacity="${d.overlay === "none" ? 0.25 : 0.1}" stroke="${base}" data-box="${i}"/>`);
      out.push(median(cx - half, cx + half, `stroke="${base}" stroke-width="2"`));
    } else if (!baseMarks.length) {
      // nothing else marks where the one value lies
      out.push(median(cx - half, cx + half, `stroke="${base}" stroke-width="2"`));
    }
    // cohort layers past the budget: a narrow box of their own (side by side when several); then every
    // layer's points at the same fixed jitter the plotted cohort's points use
    const boxed = hs.filter((h) => h.shown === "boxes");
    boxed.forEach((h, j) => {
      const hg = h.groups!.find((x) => x.g === g.g);
      if (!hg) return;
      const hw = Math.max(1.5, half * 0.42), hx = cx + (j - (boxed.length - 1) / 2) * hw * 1.25;
      const hMedian = lineCV(hx - hw / 2 - 1, vs(hg.median), hx + hw / 2 + 1, vs(hg.median), `stroke="${p.ink}" stroke-width="1.5"`);
      out.push(layerGroup(d.layers!.indexOf(h), hg.n < 2 ? [hMedian] : [
        lineCV(hx, vs(inAxis(hg.loWhisker)), hx, vs(inAxis(hg.hiWhisker)), `stroke="${h.color}"`) +
        `<rect ${rectCV(hx - hw / 2, hx + hw / 2, vs(hg.q1), vs(hg.q3), 1)} fill="${h.color}" fill-opacity="0.85"/>` + hMedian]));
    });
    // A layer's value past the axis is pinned to the frame's edge as a triangle pointing off it, and
    // counted in the caption, rather than drawn outside the figure. With the cases coloured by a
    // category, a layer is a ring round the case, so fill and ring each keep one meaning.
    for (const h of hs) if (h.shown === "points") {
      const rH = PLOT_POINT_R;
      const marks = (pts: HighlightPoint[], counted: boolean) => pts.flatMap((pt) => {
        if (!("g" in pt) || pt.g !== g.g) return [];
        const pc = cx + jitterFor(pt.id) * half * 0.9;
        if (pt.v > vhi || pt.v < vlo) {
          if (counted) offScale++;
          return [edgeMark(pt.id, pc, pt.v > vhi, rH, h.color)];
        }
        return [categorised
          ? `<circle${caseAttr(pt.id)} ${dotAt(pc, pt.v)} r="${r1(rH + 1.4)}" fill="none" stroke="${h.color}" stroke-width="1.4"/>`
          : `<circle${caseAttr(pt.id)} ${dotAt(pc, pt.v)} r="${rH}" fill="${h.color}" fill-opacity="0.9" ${halo(p)}/>`];
      });
      const key = d.layers!.indexOf(h);
      out.push(layerGroup(key, marks(h.points!, true)));
      out.push(sharedGroups(h, key, (pt) => marks([pt], false)));
    }
  });
  let y: number;
  if (across) {
    out.push(`<line x1="${L}" y1="${T + PLOT}" x2="${W - R}" y2="${T + PLOT}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    const band = bandLabels(names, gs.map((_, i) => centre(i)), bw, T + PLOT, p, { maxH: 130 });
    out.push(band.svg);
    y = T + PLOT + band.height + 4;
    out.push(label((L + W - R) / 2, y + FS.body, catTitle, { size: FS.body, fill: p.ink, anchor: "middle", maxW: plotW }));
    y += FS.body + 12;
  } else {
    out.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${T + PLOT}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    names.forEach((s, i) => out.push(label(L - 8, centre(i) + FS.small * 0.35, s, { size: FS.small, fill: p.ink, anchor: "end", maxW: labW })));
    // the category axis's title, up the left edge
    out.push(label(8 + FS.body * 0.8, T + PLOT / 2, catTitle, { size: FS.body, fill: p.ink, anchor: "middle", rotate: -90, maxW: Math.max(60, PLOT) }));
    y = T + PLOT + bottomAxisHeight(numTitle) + 12;
  }

  { const k = colours.legends(y, W, p); out.push(k.svg); y = k.y; }
  const hk = layerItems(d);
  if (hk.length) { const lg = legend(hk, 8, y, W - 16, p, { title: "point layers" }); out.push(lg.svg); y += lg.height; }
  y += 4;
  // the engine's note leads, as it does under the scatter: it is where the view says what it drew
  // over and what it had to leave out
  const cap = caption((v.note ? v.note + "  " : "") + "Box: quartiles; whiskers end at 1.5 × IQR past the box, or at the extreme value when none lies beyond (the portal's rule), computed over every case in the group; each name carries its count." +
    (singles ? " " + (singles === 1 ? "A group" : fmtInt(singles) + " groups") + " of one case " + (singles === 1 ? "has" : "have") + " no box, only " + (singles === 1 ? "its value" : "their values") + "." : "") +
    (d.overlay === "points" ? " Every value is drawn over its box; the jitter is fixed per case."
      : d.overlay === "violin" ? " The shaded width is the share of that group's values sitting at that " + (across ? "height" : "place") + ", scaled per group."
      : "") +
    (ptOffScale ? " " + fmtInt(ptOffScale) + " value" + (ptOffScale === 1 ? " lies" : "s lie") + " more than a whisker span" +
      " past the whiskers and " + (ptOffScale === 1 ? "is" : "are") + " drawn as a triangle at the frame's edge." : "") +
    (offScale ? " " + fmtInt(offScale) + (offScale === 1 ? " value of a point layer lies" : " values of point layers lie") +
      " more than a whisker span past the whiskers and " + (offScale === 1 ? "is" : "are") + " drawn as a triangle at the frame's edge." : ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0, "Plot — " + numTitle + " by " + catTitle, NO_FIGURE_TIP);
}

function table(v: DrawnResultOf<"plot"> | DrawnResultOf<"coexpression">, d: PlotData, W0: number, p: Pal): string {
  // Every category on both axes — the engine refuses a pair past CATEGORY_CAP, so what arrives is
  // already the whole table, and a table missing rows or columns is a wrong one. Ordered as the
  // engine gives them (each axis's category order, PLT-TB-3), else by marginal total.
  const marg = (key: "cx" | "cy") => {
    const t = new Map<string, number>();
    for (const c of d.cells!) t.set(c[key], (t.get(c[key]) || 0) + c.n);
    return [...t.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  };
  const xsCat = d.order?.x || marg("cx"), ysCat = d.order?.y || marg("cy");
  const at = new Map(d.cells!.map((c) => [c.cx + "\u0000" + c.cy, c.n]));
  const maxN = Math.max(1, ...d.cells!.map((c) => c.n));
  const xTitle = axisTitle(d.x), yTitle = axisTitle(d.y);
  const R = 16, T = 12;
  const labW = Math.min(W0 * 0.3, Math.max(...ysCat.map((s) => textWidth(s, FS.small))));
  const LX = 8 + FS.body + 8 + labW + 8;
  // a cell is wide enough for the largest count; past 2.5× the card's width the counts go and
  // each cell keeps its count as a tooltip instead
  const countW = textWidth(fmtInt(maxN), FS.small) + 8;
  const fitW = W0 - LX - R;
  let cw = Math.max(fitW / xsCat.length, 14);
  let counts = true;
  if (cw < countW) {
    if (LX + R + xsCat.length * countW <= W0 * 2.5) cw = countW;
    else counts = false;
  }
  const W = Math.max(W0, Math.ceil(LX + R + xsCat.length * cw));
  const chh = Math.max(18, Math.min(28, plotHeight(W0) / Math.max(1, ysCat.length)));
  const out: string[] = [];
  const shade = (n: number) => n ? 0.1 + 0.8 * Math.log1p(n) / Math.log1p(maxN) : 0.03;
  ysCat.forEach((yv, r) => {
    const cy = T + chh * r;
    out.push(label(LX - 8, cy + chh / 2 + FS.small * 0.35, yv, { size: FS.small, fill: p.ink, anchor: "end", maxW: labW }));
    xsCat.forEach((xv, c) => {
      const n = at.get(xv + "\u0000" + yv) || 0, a = shade(n);
      out.push(`<rect x="${r1(LX + cw * c)}" y="${r1(cy)}" width="${r1(cw - 1)}" height="${r1(chh - 1)}" fill="${SERIES[0]}" fill-opacity="${r1(a * 100) / 100}">` +
        `<title>${esc(xv)} × ${esc(yv)}: ${fmtInt(n)}</title></rect>`);
      // dark cells take white text; the shade is the only thing behind a count
      if (n && counts) out.push(label(LX + cw * (c + 0.5), cy + chh / 2 + FS.small * 0.35, fmtInt(n),
        { size: FS.small, fill: a > 0.55 ? "#ffffff" : p.ink, anchor: "middle" }));
    });
  });
  // the row axis's title, up the left edge
  out.push(label(8 + FS.body * 0.8, T + chh * ysCat.length / 2, yTitle, { size: FS.body, fill: p.ink, anchor: "middle", rotate: -90, maxW: Math.max(60, chh * ysCat.length) }));
  const gridBottom = T + chh * ysCat.length;
  const cols = bandLabels(xsCat, xsCat.map((_, c) => LX + cw * (c + 0.5)), cw, gridBottom, p, { maxH: 120 });
  out.push(cols.svg);
  let y = gridBottom + cols.height + 4;
  // under the grid's start, so it is seen even when the grid scrolls
  out.push(label(LX, y + FS.body, xTitle + " →", { size: FS.body, fill: p.ink, maxW: W - LX - R }));
  y += FS.body + 12;
  const cap = caption((v.note ? v.note + "  " : "") + xTitle + " across, " + yTitle + " down. " + fmtInt(d.n) + " cases counted in the database." +
    (counts ? "" : " There are too many columns to print every count; each cell gives its count on hover."), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0, "Plot — " + xTitle + " by " + yTitle, NO_FIGURE_TIP);
}

