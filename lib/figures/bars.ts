// Bar figures for the views the page shows as tables (compare, co-occurrence, co-expression,
// clinical): what MCP and `?figures=svg` get for them. Compare is grouped bars, one group per gene
// and one bar per cohort; the other three are one horizontal bar per row on a labelled value axis,
// signed about a zero line where the value has a direction.
import type { CooccurRow, CompareRow, ClinicalRow, CoexprRow, ViewResultOf } from "../types.ts";
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, legend, label, textWidth,
  seriesStyle, fmtNum, fmtPct, fmtQ, fmtInt, FS, SW, OTHER, SERIES, type SvgOpts, type LegendItem, type Scale
} from "../svg-kit.ts";

type Pal = ReturnType<typeof palette>;

/** below this the plot column stops narrowing and the figure grows instead */
const MIN_PLOT = 160;
const ROW = 22, PAD = 8, GUT = 12;

/** a direction's colour where the test is significant; the neutral grey where it is not */
const UP = SERIES[0], DOWN = SERIES[1];

interface HRow {
  label: string;
  /** null: nothing to draw (not tested, no value); ±Infinity: past the scale either way */
  v: number | null;
  fill: string;
  text: string;
  /** the row's own tooltip on its bar */
  tip?: string;
  muted?: boolean;
}

/** The figure's title line at the top; returns its drawing and the y below it. */
function titleLine(text: string, W: number, p: Pal): { svg: string; y: number } {
  return { svg: label(PAD, 16, text, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }), y: 26 };
}

/** tick labels repeated along the top of a long plot, so a reader at the first row can read the scale */
function topTicks(s: Scale, fmt: (v: number) => string, y: number, p: Pal): string {
  return s.ticks.map((t) => label(s(t), y, fmt(t), { size: FS.small, fill: p.muted, anchor: "middle" })).join("");
}

/**
 * One horizontal bar per row: label column, plot, value column, each as wide as its widest entry
 * (the label column capped at a third of the figure, labels past it cut with their full text kept).
 * `signed` puts zero in the middle; values past `cap` (or infinite) end in an arrow at the edge.
 */
function hbars(title: string, rows: HRow[], o: SvgOpts, a: {
  signed: boolean; axisTitle: string; cap?: number; ref?: { at: number; text: string };
  legend: LegendItem[]; note: string; fmtTick?: (v: number) => string;
}): string {
  const p = palette(o.theme);
  let W = Math.max(360, o.width || 720);
  const labW0 = Math.max(...rows.map((r) => textWidth(r.label, FS.body)), 0);
  const valW = Math.max(...rows.map((r) => textWidth(r.text, FS.small)), 0);
  const labW = () => Math.min(labW0, Math.max(80, W * 0.33));
  // a figure narrower than its columns grows (and scrolls) rather than squeezing the plot away
  const need = 2 * PAD + labW() + GUT + MIN_PLOT + GUT + valW;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const L = PAD + labW() + GUT, R = W - PAD - valW - GUT;

  const finite = rows.map((r) => r.v).filter((v): v is number => v != null && Number.isFinite(v));
  const capped = (v: number) => a.cap != null ? Math.min(Math.abs(v), a.cap) : Math.abs(v);
  const m = Math.max(a.ref ? a.ref.at * 1.2 : 0, ...finite.map(capped), a.cap != null && rows.some((r) => r.v != null && (!Number.isFinite(r.v) || Math.abs(r.v) > a.cap!)) ? a.cap : 0, 1e-9);
  const xs = a.signed ? linear(-m, m, L, R) : linear(0, m, L, R);
  const [d0, d1] = xs.domain;
  const fmtTick = a.fmtTick || xs.fmt;

  const out: string[] = [];
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  if (a.legend.length) {
    const lg = legend(a.legend, PAD, y, W - 2 * PAD, p, { size: FS.small });
    out.push(lg.svg);
    y += lg.height + 4;
  }
  const long = rows.length > 24;
  if (long) { out.push(topTicks(xs, fmtTick, y + FS.small, p)); y += FS.small + 6; }
  // a line of its own for the reference line's name, above the bars and clear of the legend
  if (a.ref) y += FS.small + 4;
  const top = y;
  const bottom = top + rows.length * ROW;
  // gridlines first, so bars and labels sit over them
  for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${bottom}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  let past = 0;
  rows.forEach((r, i) => {
    const ry = top + i * ROW, cy = ry + ROW / 2, ty = cy + FS.body * 0.35;
    if (i % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
    out.push(label(PAD, ty, r.label, { size: FS.body, fill: r.muted ? p.muted : p.ink, maxW: labW() }));
    if (r.v != null && r.v !== 0) {
      const off = !Number.isFinite(r.v) || (a.cap != null && Math.abs(r.v) > a.cap);
      const v = Math.max(d0, Math.min(d1, Number.isFinite(r.v) ? r.v : r.v > 0 ? d1 : d0));
      const x0 = xs(a.signed ? 0 : d0), x1 = xs(v);
      const x = Math.min(x0, x1), w = Math.max(1, Math.abs(x1 - x0));
      const h = 12;
      out.push(`<rect x="${r1(x)}" y="${r1(cy - h / 2)}" width="${r1(w)}" height="${h}" rx="1.5" fill="${r.fill}">` +
        (r.tip ? `<title>${esc(r.tip)}</title>` : "") + `</rect>`);
      if (off) {
        past++;
        const dir = v > 0 || (!a.signed) ? 1 : -1, at = x1;
        out.push(`<path d="M${r1(at + dir * 7)} ${r1(cy)} L${r1(at)} ${r1(cy - 7)} L${r1(at)} ${r1(cy + 7)} Z" fill="${r.fill}"/>`);
      }
    }
    out.push(label(W - PAD, cy + FS.small * 0.35, r.text, { size: FS.small, fill: r.muted ? p.muted : p.ink, anchor: "end" }));
  });
  if (a.signed) out.push(`<line x1="${r1(xs(0))}" y1="${top - 2}" x2="${r1(xs(0))}" y2="${bottom + 2}" stroke="${p.ink}" stroke-width="${SW.line}"/>`);
  if (a.ref && a.ref.at <= d1) {
    const rx = xs(a.ref.at);
    out.push(`<line x1="${r1(rx)}" y1="${top}" x2="${r1(rx)}" y2="${bottom}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
    out.push(label(rx + 3, top - 3, a.ref.text, { size: FS.small, fill: p.muted }));
  }
  out.push(axisBottom(xs, bottom, p, { title: a.axisTitle, minX: L - GUT, maxX: R + GUT, fmt: fmtTick }));
  y = bottom + bottomAxisHeight(a.axisTitle) + 8;
  const note = sentence(a.note) + (past ? " " + fmtInt(past) + " bar" + (past === 1 ? " runs" : "s run") + " past the axis and end" + (past === 1 ? "s" : "") +
    " in an arrow; the number beside " + (past === 1 ? "it" : "each") + " is exact." : "");
  const cap = caption(note, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title);
}

/** a note ending in a full stop, so a sentence appended to it reads as one */
const sentence = (s: string) => s.trim() && !/[.!?)]$/.test(s.trim()) ? s.trim() + "." : s.trim();
const r1 = (n: number) => Math.round(n * 10) / 10;

export function cooccurrenceSvg(v: ViewResultOf<"cooccurrence">, o: SvgOpts): string {
  const pairs = (v.pairs || []) as CooccurRow[];
  let anyInf = false;
  const rows = pairs.map((r): HRow => {
    const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : r.log2Odds;
    if (lor != null && !Number.isFinite(lor)) anyInf = true;
    const p = r.pStratified ?? r.p;
    const sig = r.q < 0.05 && lor != null && lor !== 0;
    return {
      label: r.a + " / " + r.b, v: lor, fill: sig ? (lor! > 0 ? UP : DOWN) : OTHER,
      text: (lor == null ? "–" : fmtNum(lor)) + " · " + fmtQ(r.q),
      tip: r.a + " / " + r.b + ": both " + fmtInt(r.both) + ", " + r.a + " only " + fmtInt(r.onlyA) + ", " + r.b + " only " + fmtInt(r.onlyB) +
        ", neither " + fmtInt(r.neither) + " · " + (r.pStratified != null ? "stratified " : "") + "p " + fmtQ(p).slice(2)
    };
  });
  return hbars("Co-occurrence — log₂ odds ratio", rows, o, {
    signed: true, axisTitle: "log₂ odds ratio — left: mutually exclusive, right: co-occurring",
    legend: [{ label: "co-occur, q < 0.05", color: UP }, { label: "mutually exclusive, q < 0.05", color: DOWN }, { label: "not significant", color: OTHER }],
    note: sentence(v.note || "") + (anyInf ? " An odds ratio of 0 or ∞ (a pair never or always seen together) is drawn to the edge of the axis." : "")
  });
}

export function coexpressionSvg(v: ViewResultOf<"coexpression">, o: SvgOpts): string {
  const rows = (v.coexpression || []) as CoexprRow[];
  return hbars("Co-expression — Pearson r", rows.map((r): HRow => {
    const rr = r.rMeta ?? r.r;
    const sig = r.q < 0.05 && rr != null && rr !== 0;
    return {
      label: r.a + " / " + r.b, v: rr, fill: sig ? (rr! > 0 ? UP : DOWN) : OTHER,
      text: (rr == null ? "r –" : "r = " + fmtNum(rr, 2)) + " · n = " + fmtInt(r.n) + " · " + fmtQ(r.q),
      tip: r.a + " / " + r.b + (r.rMeta != null ? ": r combined across " + (r.sites ?? 0) + " sites" : "") +
        (r.perStudy && r.perStudy.length > 1 ? "\n" + r.perStudy.map((s) => s.study + ": r " + (s.r == null ? "–" : fmtNum(s.r, 2)) + ", n " + fmtInt(s.n)).join("\n") : "")
    };
  }), o, {
    signed: true, axisTitle: "Pearson r — left: anti-correlated, right: correlated",
    legend: [{ label: "positive, q < 0.05", color: UP }, { label: "negative, q < 0.05", color: DOWN }, { label: "not significant", color: OTHER }],
    note: v.note || ""
  });
}

/** −log₁₀ q past this runs off the axis as an arrow: q < 1e-50 is beyond any reading difference */
const Q_CAP = 50;

export function clinicalSvg(v: ViewResultOf<"clinical">, o: SvgOpts): string {
  const all = (v.clinical || []) as ClinicalRow[];
  const rows = all.map((r): HRow => {
    if (r.skipped) return { label: r.attribute, v: null, fill: OTHER, text: "not tested: " + r.skipped, muted: true };
    const q = r.q;
    return {
      label: r.attribute, v: q == null ? null : q > 0 ? -Math.log10(q) : Infinity,
      fill: q != null && q < 0.05 ? SERIES[0] : OTHER,
      text: (r.test || "") + " · " + (q == null ? "q –" : fmtQ(q))
    };
  });
  return hbars("Clinical comparison — −log₁₀ q", rows, o, {
    signed: false, axisTitle: "−log₁₀ q (Benjamini–Hochberg) — longer is stronger evidence of a difference", cap: Q_CAP,
    ref: { at: -Math.log10(0.05), text: "q = 0.05" },
    legend: [{ label: "q < 0.05", color: SERIES[0] }, { label: "not significant", color: OTHER }],
    note: v.note || ""
  });
}

/** below this a column of groups is too narrow to read; more width adds columns */
const COL_MIN = 340;

/**
 * Altered %, grouped by gene: one bar per cohort in each gene's group, the cohorts keyed once in
 * a legend. Genes flow down columns as the width allows, every column on one shared scale.
 */
export function compareSvg(v: ViewResultOf<"compare">, o: SvgOpts): string {
  const p = palette(o.theme);
  const rows = (v.rows || []) as CompareRow[];
  const names = v.cohorts && v.cohorts.length ? v.cohorts : (rows[0]?.cells || []).map((c) => c.cohort);
  const k = Math.max(1, ...rows.map((r) => r.cells.length));
  let W = Math.max(360, o.width || 720);
  const grown = W < COL_MIN + 2 * PAD;
  if (grown) W = COL_MIN + 2 * PAD;
  const title = "Altered %, by cohort";

  const out: string[] = [];
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  const items: LegendItem[] = names.map((n, i) => ({ label: n, color: seriesStyle(i).color, opacity: seriesStyle(i).tint }));
  const lg = legend(items, PAD, y, W - 2 * PAD, p, { grid: names.length > 4 });
  out.push(lg.svg);
  y += lg.height + 8;

  // one bar per cohort, a gap between genes; the gene's name and q head its group on the left
  const BAR = k > 6 ? 10 : 12, GAP = 10;
  const groupH = Math.max(k * BAR, FS.body + FS.small + 6) + GAP;
  const cols = Math.max(1, Math.min(Math.ceil(rows.length / 4), Math.floor((W - 2 * PAD + GUT * 2) / (COL_MIN + GUT * 2))));
  const perCol = Math.ceil(rows.length / cols);
  const colW = (W - 2 * PAD - (cols - 1) * GUT * 2) / cols;
  const qText = (r: CompareRow) => r.qAny != null ? fmtQ(r.qAny) : "";
  const geneW = Math.max(...rows.map((r) => Math.max(textWidth(r.gene, FS.body, 600), textWidth(qText(r), FS.small))), 30);
  const valW = textWidth("100.0%", FS.small) + 4;
  const top = y, plotH = perCol * groupH;
  const maxPct = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.anyPct ?? 0)));
  let notProfiled = 0;

  for (let c = 0; c < cols; c++) {
    const cx = PAD + c * (colW + GUT * 2);
    const L = cx + geneW + GUT, R = cx + colW - valW;
    const xs = linear(0, Math.min(100, maxPct), L, R);
    for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + plotH}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    rows.slice(c * perCol, (c + 1) * perCol).forEach((r, gi) => {
      const gy = top + gi * groupH;
      out.push(label(cx, gy + FS.body, r.gene, { size: FS.body, weight: 600, fill: p.ink, maxW: geneW }));
      const q = qText(r);
      if (q) out.push(label(cx, gy + FS.body + FS.small + 3, q, { size: FS.small, fill: r.qAny! < 0.05 ? p.ink : p.muted }));
      r.cells.forEach((cell, ci) => {
        const st = seriesStyle(ci), by = gy + ci * BAR;
        const pct = cell.anyPct;
        const tip = (names[ci] || cell.cohort) + " — " + r.gene + ": " + (pct == null ? "not profiled" : fmtPct(pct) + " (" + fmtInt(cell.any) + " of " + fmtInt(cell.profiled) + " profiled)");
        if (pct == null) {
          notProfiled++;
          out.push(label(L + 2, by + BAR / 2 + FS.small * 0.35, "not profiled", { size: FS.small, fill: p.muted }));
          return;
        }
        const w = Math.max(pct > 0 ? 1 : 0, xs(pct) - L);
        out.push(`<rect x="${r1(L)}" y="${r1(by + 1)}" width="${r1(w)}" height="${BAR - 2}" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}` +
          `><title>${esc(tip)}</title></rect>`);
        out.push(label(L + w + 3, by + BAR / 2 + FS.small * 0.35, fmtPct(pct), { size: FS.small, fill: p.muted }));
      });
    });
    out.push(`<line x1="${r1(L)}" y1="${top}" x2="${r1(L)}" y2="${top + plotH}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    out.push(axisBottom(xs, top + plotH, p, { title: "altered, % of profiled", minX: L - GUT, maxX: cx + colW, fmt: (x) => fmtNum(x) + "%" }));
  }
  y = top + plotH + bottomAxisHeight("altered") + 8;
  const note = sentence(v.note || "") + (notProfiled ? " " + fmtInt(notProfiled) + " cohort–gene pair" + (notProfiled === 1 ? " was" : "s were") + " not profiled and " + (notProfiled === 1 ? "has" : "have") + " no bar." : "") +
    (rows.some((r) => r.qAny != null) ? " The q under each gene compares its altered share across the cohorts." : "");
  const cap = caption(note, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title + " — " + names.join(", "));
}
