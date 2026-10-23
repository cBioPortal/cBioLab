// Enrichment figure: every gene's alteration frequency compared between cohorts — the portal's
// three charts (volcano, frequency scatter, most-altered genes) and its table.
import type { ViewResultOf, DrawnResultOf } from "../../types.ts";
import { volcano, volcanoPlotH } from "../../figures/volcano.ts";
import {
  palette, frame, caption, label, textWidth, wrapWidth, linear, axisLeft, axisBottom, leftAxisWidth,
  bottomAxisHeight, bandLabels, legend, seriesStyle, textOn, fmtInt, fmtPct, pDigits, tickFormat,
  esc, FS, SW, type SvgOpts
} from "../../svg-kit.ts";

type Pal = ReturnType<typeof palette>;

/** room left of a panel's left axis title */
const EDGE = 6;

// ---- the portal's three charts -----------------------------------------------------------------

type EnResult = NonNullable<ViewResultOf<"enrichment">["enrichment"]>;
type EnRow = EnResult["rows"][number];
type Panel = { svg: string; height: number; unplaced?: string[] };

const groupColor = (r: EnResult, g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g)));
const dotColor = (r: EnResult, row: EnRow, p: Pal) => row.q < 0.05 ? groupColor(r, row.enrichedIn).color : p.muted;
const freqTip = (g: EnRow) => g.gene + ": " + g.cells.map((c) => c.cohort + " " + (c.pct == null ? "–" : fmtPct(c.pct)) + " (" + fmtInt(c.altered) + " / " + fmtInt(c.profiled) + ")").join(", ") + " · q " + pDigits(g.q);

/** Two groups: the volcano, log2 ratio against −log₁₀ p, the portal's first chart. */
function enrichmentVolcano(r: EnResult, p: Pal, x0: number, y0: number, w: number, plotH: number): Panel | null {
  if (r.groups.length !== 2 || !r.grid) return null;
  const g = r.grid;
  const xOf = (row: EnRow) => row.log2Ratio == null ? (row.cells[0].altered ? g.xMax : -g.xMax) : row.log2Ratio;
  return volcano(p, { x0, y0, width: w, plotH, grid: g, labels: r.labels, xTitle: "Log2 Ratio", sides: [r.groups[0], r.groups[1]], r: 3,
    pts: r.rows.map((row) => ({ key: row.gene, x: xOf(row), p: row.p, color: dotColor(r, row, p), tip: freqTip(row) })) });
}

/** Two groups: each gene's frequency in one against the other, the diagonal where they are equal. */
function enrichmentScatter(r: EnResult, p: Pal, x0: number, y0: number, w: number, plotH: number): Panel | null {
  if (r.groups.length !== 2) return null;
  const top = Math.max(1, ...r.rows.flatMap((g) => g.cells.map((c) => c.pct ?? 0)));
  const T = y0 + FS.small + 10;
  const yTitle = "Altered frequency in " + r.groups[1] + " (%)", xTitle = "Altered frequency in " + r.groups[0] + " (%)";
  const ys0 = linear(0, top, T + plotH, T);
  const L = x0 + EDGE + leftAxisWidth(ys0, yTitle);
  const S = Math.max(120, Math.min(plotH, x0 + w - 8 - L));
  const ys = linear(0, top, T + S, T), xs = linear(0, top, L, L + S);
  const out: string[] = [];
  out.push(label(L, y0 + FS.small, "the " + fmtInt(r.rows.length) + " most significant genes", { size: FS.small, fill: p.muted, maxW: x0 + w - L }));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: L + S }));
  out.push(axisBottom(xs, T + S, p, { title: xTitle, gridTo: T, minX: x0, maxX: x0 + w }));
  out.push(`<line x1="${L}" y1="${T + S}" x2="${L + S}" y2="${T}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="4 3"/>`);
  out.push(r.rows.map((g) => `<circle cx="${r1(xs(g.cells[0].pct ?? 0))}" cy="${r1(ys(g.cells[1].pct ?? 0))}" r="3" fill="${dotColor(r, g, p)}" opacity="0.75"><title>${esc(freqTip(g))}</title></circle>`).join(""));
  return { svg: out.join(""), height: T + S + bottomAxisHeight(xTitle) - y0 };
}

/** "Genes with highest frequency in any group": the ten most-altered genes, a bar per group. */
function enrichmentTop(r: EnResult, p: Pal, x0: number, y0: number, w: number, plotH: number, n = 10): Panel {
  const k = r.groups.length;
  const genes = [...r.rows].sort((a, b) => Math.max(...b.cells.map((c) => c.pct ?? 0)) - Math.max(...a.cells.map((c) => c.pct ?? 0))).slice(0, n);
  const top = Math.max(1, ...genes.flatMap((g) => g.cells.map((c) => c.pct ?? 0)));
  const out: string[] = [];
  out.push(label(x0 + EDGE, y0 + FS.title, "Genes with highest frequency in any group", { size: FS.title, fill: p.ink, weight: 600, maxW: w }));
  const T = y0 + FS.title + 12, yTitle = "Alteration frequency (%)";
  const ys = linear(0, top, T + plotH, T);
  const L = x0 + EDGE + leftAxisWidth(ys, yTitle), R = x0 + w - 4;
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R }));
  const band = (R - L) / Math.max(1, genes.length);
  const bw = Math.max(2, Math.min(14, (band - 6) / k));
  genes.forEach((g, i) => {
    const c0 = L + i * band + (band - bw * k) / 2;
    g.cells.forEach((c, ci) => {
      const st = seriesStyle(ci), y = ys(c.pct ?? 0);
      out.push(`<rect x="${r1(c0 + ci * bw)}" y="${r1(y)}" width="${r1(Math.max(1, bw - 1))}" height="${r1(T + plotH - y)}" fill="${st.color}"` +
        (st.tint < 1 ? ` opacity="${st.tint}"` : "") + `><title>${esc(g.gene + " in " + c.cohort + ": " + (c.pct == null ? "–" : fmtPct(c.pct)) + " (" + fmtInt(c.altered) + " / " + fmtInt(c.profiled) + ")")}</title></rect>`);
    });
  });
  out.push(`<line x1="${L}" y1="${T + plotH}" x2="${R}" y2="${T + plotH}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  const bl = bandLabels(genes.map((g) => g.gene + (g.q < 0.05 ? " *" : "")), genes.map((_, i) => L + (i + 0.5) * band), band, T + plotH, p, { maxH: 70 });
  out.push(bl.svg);
  let y = T + plotH + bl.height + 6;
  const lg = legend(r.groups.map((g, i) => ({ label: g, color: seriesStyle(i).color, opacity: seriesStyle(i).tint })), L, y, R - L, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height;
  if (genes.some((g) => g.q < 0.05)) {
    out.push(label(L, y + FS.small + 2, "* q < 0.05: the gene's frequency differs between the groups", { size: FS.small, fill: p.muted, maxW: R - L }));
    y += FS.small + 6;
  }
  return { svg: out.join(""), height: y - y0 };
}

const GAP = 28;
/** below this a chart stops sharing its row */
const MIN_PANEL = 300;

/**
 * The portal's charts laid out for `W`: the three in one row when they fit, the volcano and the
 * scatter over the bar chart when two do, else one under another. More than two groups: the bar
 * chart alone. Returns the drawing from y0, its height, and the volcano labels it could not place.
 */
export function enrichmentCharts(r: EnResult, p: Pal, W: number, y0: number): { svg: string; height: number; unplaced: string[] } {
  const two = r.groups.length === 2;
  const out: string[] = [];
  let unplaced: string[] = [];
  const keep = (c: Panel | null) => { if (c) { out.push(c.svg); if (c.unplaced) unplaced = c.unplaced; } return c ? c.height : 0; };
  if (!two) return { ...enrichmentTop(r, p, 0, y0, W, plotHFor(W * 0.5)), unplaced };
  const avail = W - 2 * GAP;
  if (avail / 3 >= MIN_PANEL) {
    const vw = Math.round(avail * 0.38), sw = Math.round(avail * 0.28), tw = avail - vw - sw;
    const ph = volcanoPlotH(vw);
    const h = Math.max(keep(enrichmentVolcano(r, p, 0, y0, vw, ph)), keep(enrichmentScatter(r, p, vw + GAP, y0, sw, Math.min(ph, sw))),
      keep(enrichmentTop(r, p, vw + sw + 2 * GAP, y0, tw, ph - 60)));
    return { svg: out.join(""), height: h, unplaced };
  }
  if ((W - GAP) / 2 >= MIN_PANEL) {
    const vw = Math.round((W - GAP) * 0.55), sw = W - GAP - vw, ph = volcanoPlotH(vw);
    const h1 = Math.max(keep(enrichmentVolcano(r, p, 0, y0, vw, ph)), keep(enrichmentScatter(r, p, vw + GAP, y0, sw, Math.min(ph, sw))));
    const h2 = keep(enrichmentTop(r, p, 0, y0 + h1 + GAP, W, plotHFor(W * 0.5)));
    return { svg: out.join(""), height: h1 + GAP + h2, unplaced };
  }
  let y = y0;
  y += keep(enrichmentVolcano(r, p, 0, y, W, volcanoPlotH(W))) + GAP;
  y += keep(enrichmentScatter(r, p, 0, y, W, Math.min(volcanoPlotH(W), W))) + GAP;
  y += keep(enrichmentTop(r, p, 0, y, W, plotHFor(W)));
  return { svg: out.join(""), height: y - y0, unplaced };
}
const plotHFor = (w: number) => Math.round(Math.max(180, Math.min(260, w * 0.6)));

/** the charts alone, framed, at `o.width` — what the page draws above its own table */
export function enrichmentChartsSvg(r: EnResult, o: SvgOpts = {}): string {
  const p = palette(o.theme), want = o.width || 960, W = Math.max(MIN_PANEL, want);
  const c = enrichmentCharts(r, p, W, 4);
  return frame(W, 4 + c.height + 8, c.svg, p.bg, W > want, enrichTitle(r));
}

const enrichTitle = (r: EnResult) => "Alteration enrichment — " + r.alteration + " — " + r.groups.join(" vs ");

// ---- the server figure: the charts, then the table ---------------------------------------------

export function enrichmentSvg(v: DrawnResultOf<"enrichment">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.enrichment;
  const want = o.width || 960;
  const two = r.groups.length === 2;
  const shown = r.rows.slice(0, 18);
  // the table's columns, each as wide as its widest entry
  const cell = (c: EnRow["cells"][number] | undefined) => !c ? "–" : fmtInt(c.altered) + " (" + (c.pct == null ? "–" : fmtPct(c.pct)) + ")";
  const f2 = tickFormat(0.01);
  const ratio = (g: EnRow) => g.log2Ratio == null ? (g.cells[0].altered ? ">10" : "<−10") : f2(g.log2Ratio);
  type Col = { head: string; w: number; anchor: "start" | "end"; text: (g: EnRow) => string; weight?: (g: EnRow) => number };
  const col = (head: string, anchor: "start" | "end", text: (g: EnRow) => string, o2: { weight?: (g: EnRow) => number; headMax?: number } = {}): Col => ({
    head, anchor, text, weight: o2.weight,
    w: Math.ceil(Math.max(Math.min(o2.headMax ?? Infinity, textWidth(head, FS.body, 600)), ...shown.map((g) => textWidth(text(g), FS.body, o2.weight ? o2.weight(g) : 400)))) });
  const cols: Col[] = [
    col("Gene", "start", (g) => g.gene, { weight: () => 600 }),
    col("Cytoband", "start", (g) => g.cytoband || ""),
    ...r.groups.map((name, i) => col(name, "end", (g) => cell(g.cells[i]), { headMax: 150 })),
    ...(two ? [col("Log2 Ratio", "end", ratio)] : []),
    col("p-Value", "end", (g) => pDigits(g.p)),
    col("q-Value", "end", (g) => pDigits(g.q), { weight: (g) => g.q < 0.05 ? 600 : 400 }),
  ];
  const CG = 14, BADGE_MAX = 170;
  const badgeW = Math.min(BADGE_MAX, Math.max(textWidth("Enriched in", FS.body, 600), ...shown.map((g) => textWidth(g.enrichedIn, FS.small, 600) + 12)));
  const tableW = 8 + cols.reduce((a, c) => a + c.w + CG, 0) + badgeW + 8;
  const W = Math.max(want, Math.ceil(tableW), MIN_PANEL);

  const out: string[] = [];
  const head = fmtInt(r.tested) + " genes tested for " + r.alteration + " · " + fmtInt(r.significant) + " at q < 0.05 · " + r.test;
  const hl = wrapWidth(head, W - 16, FS.body);
  hl.forEach((l, i) => out.push(label(8, 14 + i * Math.round(FS.body * 1.4), l, { size: FS.body, fill: p.muted })));
  let y = 14 + hl.length * Math.round(FS.body * 1.4) + 6;
  const charts = enrichmentCharts(r, p, W, y);
  out.push(charts.svg);
  y += charts.height + 24;

  // the table: Gene · Cytoband · each group n (%) · Log2 Ratio · p · q · Enriched in
  let cx = 8;
  const at: number[] = [];
  for (const c of cols) {
    const x = c.anchor === "end" ? cx + c.w : cx;
    at.push(x);
    out.push(label(x, y, c.head, { size: FS.body, fill: p.ink, weight: 600, anchor: c.anchor, maxW: c.w }));
    cx += c.w + CG;
  }
  const bx = cx;
  out.push(label(bx, y, two ? "Enriched in" : "Most enriched in", { size: FS.body, fill: p.ink, weight: 600, maxW: badgeW }));
  out.push(`<line x1="8" y1="${y + 5}" x2="${r1(bx + badgeW)}" y2="${y + 5}" stroke="${p.line}" stroke-width="${SW.series}"/>`);
  const ROW = 18;
  shown.forEach((g, i) => {
    const yy = y + 6 + (i + 1) * ROW;
    cols.forEach((c, j) => out.push(label(at[j], yy, c.text(g), { size: FS.body, fill: p.ink, anchor: c.anchor, weight: c.weight ? c.weight(g) : 400 })));
    const sig = g.q < 0.05, st = groupColor(r, g.enrichedIn);
    const fill = sig ? st.color : p.line, tw = Math.min(badgeW, textWidth(g.enrichedIn, FS.small, 600) + 12);
    out.push(`<rect x="${r1(bx)}" y="${yy - 11}" width="${r1(tw)}" height="15" rx="3" fill="${fill}"${sig && st.tint < 1 ? ` opacity="${st.tint}"` : ""}/>`);
    out.push(label(bx + 6, yy, g.enrichedIn, { size: FS.small, fill: sig ? textOn(st.color) : p.ink, weight: 600, maxW: tw - 12 }));
  });
  y += 6 + shown.length * ROW + 6;
  if (r.tested > shown.length) {
    y += FS.small + 4;
    out.push(label(8, y, "+" + fmtInt(r.tested - shown.length) + " more genes tested (the full table is in the result and the MCP text)", { size: FS.small, fill: p.muted, maxW: W - 16 }));
  }
  y += 6;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, enrichTitle(r));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
