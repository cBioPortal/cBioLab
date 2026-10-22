// Differential expression figure: a volcano of every gene (the shared one, lib/figures/enrichment.ts),
// and the GSEA gene sets — their normalised scores as bars, the strongest set each way as a
// running-sum curve over the ranking.
import type { ViewResultOf, DrawnResultOf } from "../types.ts";
import {
  palette, frame, caption, label, textWidth, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight,
  legend, fmtInt, fmtNum, fmtQ, FS, SW, SERIES, OTHER, type SvgOpts
} from "../svg-kit.ts";
import { volcano, volcanoPlotH } from "./volcano.ts";

type Pal = ReturnType<typeof palette>;
type DeResult = NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>;
type GseaSet = NonNullable<DeResult["gsea"]>["sets"][number];

/** below this the volcano and the gene sets stop sharing a row */
const MIN_PANEL = 340;
const GAP = 28;
/** gene sets drawn as bars; the rest are counted */
const SHOWN_SETS = 12;

const setName = (name: string) => name.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase();

export function diffexprSvg(v: DrawnResultOf<"diffexpr">, o: SvgOpts): string {
  const p = palette(o.theme), d = v.diffexpr;
  const want = o.width || 960, W = Math.max(MIN_PANEL, want);
  const [A, B] = d.groups;
  const hasGsea = !!(d.gsea && d.gsea.sets.length);
  const side = hasGsea && (W - GAP) / 2 >= MIN_PANEL;
  const vw = side ? Math.round((W - GAP) * 0.5) : W;

  const out: string[] = [];
  // the count of genes each way, as a legend of the volcano's colours
  const lg = legend([
    { label: fmtInt(d.up) + " higher in " + A, color: SERIES[0], kind: "dot" },
    { label: fmtInt(d.down) + " higher in " + B, color: SERIES[1], kind: "dot" },
    { label: "not significant", color: OTHER, kind: "dot" },
  ], 8, 2, vw - 16, p, { size: FS.small, title: fmtInt(d.tested) + " genes, q < 0.05:" });
  out.push(lg.svg);
  const y0 = 2 + lg.height + 4;
  const vo = volcano(p, {
    x0: 0, y0, width: vw, plotH: volcanoPlotH(vw), grid: d.grid, labels: d.labels, r: 2,
    xTitle: d.effectLabel + " (" + A + " − " + B + ")", sides: ["higher in " + A, "higher in " + B],
    cellColor: (cls) => cls === 1 ? SERIES[0] : cls === 2 ? SERIES[1] : OTHER,
    pts: d.points.map((g) => ({ key: g.gene, x: g.effect, p: g.p, color: g.q < 0.05 ? (g.effect > 0 ? SERIES[0] : SERIES[1]) : OTHER,
      tip: g.gene + ": " + fmtNum(g.effect) + " · " + fmtQ(g.q) })),
  });
  out.push(vo.svg);
  let bottom = y0 + vo.height;
  if (hasGsea) {
    const gx = side ? vw + GAP : 0, gy = side ? 2 : bottom + GAP;
    const g = gseaPanel(d, p, gx, gy, side ? W - gx : W);
    out.push(g.svg);
    bottom = Math.max(bottom, gy + g.height);
  }
  const cap = caption(v.caveat || "", W, bottom + 4, p.muted);
  return frame(W, bottom + 4 + cap.height + 8, out.join("") + cap.svg, p.bg, W > want,
    "Differential expression — " + d.profileType + " — " + A + " vs " + B);
}

/** the gene sets: one bar per set on a shared NES axis, then the strongest set each way as a curve */
function gseaPanel(d: DeResult, p: Pal, x0: number, y0: number, w: number): { svg: string; height: number } {
  const gs = d.gsea!, sets = gs.sets, shown = sets.slice(0, SHOWN_SETS);
  const [A, B] = d.groups;
  const out: string[] = [];
  out.push(label(x0, y0 + FS.title, "Gene-set enrichment", { size: FS.title, fill: p.ink, weight: 600, maxW: w }));
  out.push(label(x0, y0 + FS.title + 4 + FS.small, "preranked GSEA, " + fmtInt(gs.permutations) + " permutations · bars are q < 0.05 when solid",
    { size: FS.small, fill: p.muted, maxW: w }));
  const ROW = 18, top = y0 + FS.title + FS.small + 16;
  // columns: set name | NES bar | "NES · q"
  const val = (x: GseaSet) => fmtNum(x.nes, 2) + " · " + fmtQ(x.q);
  const valW = Math.max(...shown.map((x) => textWidth(val(x), FS.small)));
  const nameW = Math.min(w * 0.42, Math.max(...shown.map((x) => textWidth(setName(x.name), FS.body))));
  const barL = x0 + nameW + 10, barR = x0 + w - valW - 10;
  const m = Math.max(1, ...shown.map((x) => Math.abs(x.nes)));
  const xs = linear(-m, m, barL, barR);
  const plotB = top + shown.length * ROW;
  shown.forEach((x, i) => {
    const y = top + i * ROW, cy = y + ROW / 2;
    const sig = x.q < 0.05;
    out.push(label(x0, cy + FS.body * 0.35, setName(x.name), { size: FS.body, fill: sig ? p.ink : p.muted, maxW: nameW }));
    const a = xs(Math.min(0, x.nes)), b = xs(Math.max(0, x.nes));
    out.push(`<rect x="${r1(a)}" y="${y + 3}" width="${r1(Math.max(0.5, b - a))}" height="${ROW - 6}" rx="2" fill="${x.nes >= 0 ? SERIES[0] : SERIES[1]}" opacity="${sig ? 0.9 : 0.35}"/>`);
    out.push(label(x0 + w, cy + FS.small * 0.35, val(x), { size: FS.small, fill: p.muted, anchor: "end" }));
  });
  out.push(`<line x1="${r1(xs(0))}" y1="${top - 2}" x2="${r1(xs(0))}" y2="${plotB}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  const nesTitle = "NES";
  out.push(axisBottom(xs, plotB, p, { title: nesTitle, minX: barL - 20, maxX: x0 + w }));
  let y = plotB + bottomAxisHeight(nesTitle) + FS.small + 4;
  const half = (barR - barL) / 2 - 6;
  out.push(label(barL, y, "← higher in " + B, { size: FS.small, fill: p.muted, maxW: half }));
  out.push(label(barR, y, "higher in " + A + " →", { size: FS.small, fill: p.muted, anchor: "end", maxW: half }));
  y += 4;
  if (sets.length > shown.length) {
    y += FS.small + 2;
    out.push(label(x0, y, "+" + fmtInt(sets.length - shown.length) + " more sets tested (" + fmtInt(sets.filter((x) => x.q < 0.05).length) +
      " of " + fmtInt(sets.length) + " at q < 0.05) — every set is in the result and the MCP text", { size: FS.small, fill: p.muted, maxW: w }));
  }
  y += 14;
  // running-sum curves: the strongest set in each direction
  const best = [sets.find((x) => x.nes > 0), sets.find((x) => x.nes < 0)].filter((x): x is GseaSet => !!x);
  for (const x of best) {
    const c = runningSum(x, d.tested, p, x0, y, w, A, B);
    out.push(c.svg);
    y += c.height + 12;
  }
  return { svg: out.join(""), height: y - y0 };
}

/** one set's running enrichment score along the ranking, its members as ticks under it */
function runningSum(x: GseaSet, n: number, p: Pal, x0: number, y0: number, w: number, A: string, B: string): { svg: string; height: number } {
  const out: string[] = [];
  const col = x.nes >= 0 ? SERIES[0] : SERIES[1];
  const head = setName(x.name) + " — ES " + fmtNum(x.es, 2) + ", " + fmtInt(x.leadingEdge.length) + " leading-edge genes";
  out.push(label(x0, y0 + FS.body, head, { size: FS.body, fill: p.ink, maxW: w }));
  const T = y0 + FS.body + 8, CH = 72;
  const lo = Math.min(0, ...x.curve), hi = Math.max(0, ...x.curve);
  const ys = linear(lo, hi, T + CH, T, { count: 4 });
  const yTitle = "ES";
  const L = x0 + 6 + leftAxisWidth(ys, yTitle), R = x0 + w - 4;
  // ranks run 1…n; members and the curve are given as 0-based positions
  const xs = linear(1, Math.max(2, n), L, R, { nice: false });
  const at = (i: number) => r1(xs(i + 1));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R }));
  out.push(`<line x1="${L}" y1="${r1(ys(0))}" x2="${R}" y2="${r1(ys(0))}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  out.push(`<path d="M${x.curve.map((v, i) => at(x.curveAt[i]) + " " + r1(ys(v))).join(" L")}" fill="none" stroke="${col}" stroke-width="${SW.series}" stroke-linejoin="round"/>`);
  const tb = T + CH + 4;
  let ticks = "";
  for (const h of x.hits) ticks += `M${at(h)} ${tb}v8`;
  out.push(`<path d="${ticks}" stroke="${p.ink}" stroke-width="${SW.hair}"/>`);
  out.push(axisBottom(xs, tb + 10, p, { fmt: fmtInt, minX: x0, maxX: x0 + w }));
  const ly = tb + 10 + bottomAxisHeight() + FS.small, third = (R - L) / 3 - 6;
  out.push(label(L, ly, "← higher in " + A, { size: FS.small, fill: p.muted, maxW: third }));
  out.push(label((L + R) / 2, ly, "gene rank, of " + fmtInt(n), { size: FS.small, fill: p.muted, anchor: "middle", maxW: third }));
  out.push(label(R, ly, "higher in " + B + " →", { size: FS.small, fill: p.muted, anchor: "end", maxW: third }));
  return { svg: out.join(""), height: ly + 4 - y0 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
