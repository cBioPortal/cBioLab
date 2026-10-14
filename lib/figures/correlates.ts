// Correlates figure: one gene's expression against every gene's — every ρ as a histogram, and the
// most positive and most negative genes listed with their ρ as a bar.
import type { ViewResult } from "../types.ts";
import {
  palette, frame, caption, label, textWidth, wrapWidth, linear, axisLeft, axisBottom, leftAxisWidth,
  bottomAxisHeight, fmtInt, pDigits, tickFormat, esc, FS, SW, SERIES, type SvgOpts
} from "../svg-kit.ts";

type Pal = ReturnType<typeof palette>;
type CoResult = NonNullable<ViewResult["correlates"]>;
type CoGene = CoResult["positive"][number];

const GAP = 28;
/** a list narrower than this goes under the histogram rather than beside it */
const MIN_LIST = 250;
/** genes listed each way; the rest are counted */
const MAX_ROWS = 25;
const f2 = tickFormat(0.01);

export function correlatesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.correlates!;
  const want = o.width || 960, W = Math.max(MIN_LIST + 16, want);
  const out: string[] = [];
  const head = fmtInt(r.tested) + " genes against " + r.gene + " · " + fmtInt(r.significant) + " at q < 0.05 · Spearman ρ" + (r.rhoFrom === "meta" ? " (Fisher-z across studies)" : "");
  const hl = wrapWidth(head, W - 16, FS.body);
  hl.forEach((l, i) => out.push(label(8, 14 + i * Math.round(FS.body * 1.4), l, { size: FS.body, fill: p.muted })));
  const y0 = 14 + hl.length * Math.round(FS.body * 1.4) + 6;

  const ROWS = Math.min(MAX_ROWS, Math.max(r.positive.length, r.negative.length));
  // the histogram beside two lists when all three fit; else the lists go under it
  const hw0 = Math.round(Math.max(280, Math.min(440, W * 0.32)));
  const beside = W - hw0 - GAP >= 2 * MIN_LIST + GAP;
  const hw = beside ? hw0 : W;
  const h = histogram(r, p, 0, y0, hw);
  out.push(h.svg);
  let bottom = y0 + h.height;
  const lx = beside ? hw + GAP : 8, ly = beside ? y0 : bottom + GAP, lw = W - lx - 8;
  const pair = lw >= 2 * MIN_LIST + GAP;
  const colW = pair ? (lw - GAP) / 2 : lw;
  const a = list(r.positive.slice(0, ROWS), p, lx, ly, colW, "rise with " + r.gene, SERIES[0]);
  const b = list(r.negative.slice(0, ROWS), p, pair ? lx + colW + GAP : lx, pair ? ly : ly + a.height + GAP, colW, "fall as " + r.gene + " rises", SERIES[1]);
  out.push(a.svg, b.svg);
  bottom = Math.max(bottom, pair ? ly + Math.max(a.height, b.height) : ly + a.height + GAP + b.height);
  const hidden = Math.max(0, r.positive.length - ROWS) + Math.max(0, r.negative.length - ROWS);
  bottom += FS.small + 8;
  out.push(label(lx, bottom, (hidden ? "+" + fmtInt(hidden) + " more listed in the result and the MCP text; " : "") +
    "every one of the " + fmtInt(r.tested) + " genes is in the histogram", { size: FS.small, fill: p.muted, maxW: W - lx - 8 }));
  bottom += 8;
  const cap = caption(v.caveat || "", W, bottom, p.muted);
  return frame(W, bottom + cap.height + 8, out.join("") + cap.svg, p.bg, W > want,
    "Co-expression — " + r.gene + " against every gene — " + r.cohort);
}

/** every tested gene's ρ in bins of 0.05 */
function histogram(r: CoResult, p: Pal, x0: number, y0: number, w: number): { svg: string; height: number } {
  const out: string[] = [];
  const maxN = Math.max(1, ...r.histogram.map((h) => h[1]));
  const T = y0 + 8, H = Math.round(Math.max(160, Math.min(240, w * 0.55)));
  const yTitle = "genes", xTitle = "Spearman ρ with " + r.gene;
  const ys = linear(0, maxN, T + H, T);
  ys.ticks = ys.ticks.filter((t) => Number.isInteger(t));
  const L = x0 + 8 + leftAxisWidth(ys, yTitle, fmtInt), R = x0 + w - 8;
  const xs = linear(-1, 1, L, R, { nice: false });
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R, fmt: fmtInt }));
  const bw = xs(-0.95) - xs(-1);
  for (const [lo, n] of r.histogram) {
    if (!n) continue;
    const y = ys(n);
    out.push(`<rect x="${r1(xs(lo) + 0.3)}" y="${r1(y)}" width="${r1(Math.max(0.5, bw - 0.6))}" height="${r1(T + H - y)}" fill="${lo < 0 ? SERIES[1] : SERIES[0]}" opacity="0.8">` +
      `<title>${esc("ρ " + f2(lo) + " to " + f2(lo + 0.05) + ": " + fmtInt(n) + " genes")}</title></rect>`);
  }
  out.push(`<line x1="${r1(xs(0))}" y1="${T}" x2="${r1(xs(0))}" y2="${T + H}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  out.push(axisBottom(xs, T + H, p, { title: xTitle, minX: x0, maxX: x0 + w }));
  return { svg: out.join(""), height: T + H + bottomAxisHeight(xTitle) - y0 };
}

/** one direction's genes: name, |ρ| as a bar, then ρ · r · q in columns */
function list(genes: CoGene[], p: Pal, x0: number, y0: number, w: number, title: string, color: string): { svg: string; height: number } {
  const out: string[] = [];
  const ROW = 16;
  const cols: [string, (g: CoGene) => string][] = [["ρ", (g) => g.rho == null ? "–" : f2(g.rho)], ["r", (g) => g.r == null ? "–" : f2(g.r)], ["q", (g) => pDigits(g.q)]];
  const widths = cols.map(([h, f]) => Math.max(textWidth(h, FS.small), ...genes.map((g) => textWidth(f(g), FS.small))));
  const valsW = widths.reduce((a, b) => a + b + 10, 0);
  const nameW = Math.min(w * 0.4, Math.max(textWidth("gene", FS.small), ...genes.map((g) => textWidth(g.gene, FS.body, 600))));
  const barL = x0 + nameW + 8, barW = Math.max(20, w - nameW - 8 - valsW - 8);
  let y = y0 + FS.body;
  out.push(`<rect x="${x0}" y="${y - 9}" width="10" height="10" rx="2" fill="${color}"/>`);
  out.push(label(x0 + 15, y, title, { size: FS.body, fill: p.ink, weight: 600, maxW: barL + barW - x0 - 15 }));
  let cx = x0 + w;
  const at: number[] = [];
  for (let i = cols.length - 1; i >= 0; i--) { at[i] = cx; cx -= widths[i] + 10; }
  cols.forEach(([h], i) => out.push(label(at[i], y, h, { size: FS.small, fill: p.muted, anchor: "end" })));
  y += 4;
  out.push(`<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="${p.line}" stroke-width="${SW.line}"/>`);
  genes.forEach((g, i) => {
    const mid = y + 2 + i * ROW + ROW / 2;
    out.push(label(x0, mid + FS.body * 0.35, g.gene, { size: FS.body, fill: p.ink, weight: 600, maxW: nameW }));
    out.push(`<rect x="${r1(barL)}" y="${mid - 4.5}" width="${r1(Math.max(0.5, barW * Math.abs(g.rho ?? 0)))}" height="9" fill="${color}" opacity="0.85"/>`);
    cols.forEach(([, f], j) => out.push(label(at[j], mid + FS.small * 0.35, f(g), { size: FS.small, fill: p.muted, anchor: "end" })));
  });
  return { svg: out.join(""), height: y + 2 + genes.length * ROW - y0 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
