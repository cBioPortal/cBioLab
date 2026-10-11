// Server-side renderers: one ViewResult -> one SVG figure.
//
// The same contract lib/oncoprint-svg.ts already follows — the engine produces
// data, the renderer is pure and knows nothing about where the picture is going.
// That is what lets one figure appear identically in the web UI, in a chat
// transcript, and in an MCP client: there is only ever one renderer.
//
// TWO RULES, both learned the hard way elsewhere in this codebase:
//
//  1. Every label is escaped. Cohort names and attribute values are user input
//     and land in <text>; the web UI injects these with dangerouslySetInnerHTML.
//  2. Scaling is uniform. An SVG scaled with preserveAspectRatio="none" shears
//     circles into ellipses and slants text — the bug that forced the lollipop
//     out of SVG once already. These render at a fixed viewBox and are scaled
//     by the container, so geometry is preserved.
//
// Colours come from CSS custom properties with literal fallbacks, so an SVG
// inlined in the app follows the page theme while the same string rasterised
// for a chat gets a fixed light figure.
import { categoryColor, isAbsent, jitterFor } from "./plot.ts";
import { filterHotspotGene } from "./lollipop.ts";
import { lollipopPanelsSvg, lollipopSummaryText } from "./lollipop-svg.ts";
export { lollipopSummaryText };
import { survivalAxis } from "./stats.ts";
import type { ViewResult, KmCurve, CooccurRow, HotspotGene, CompareRow, ClinicalRow, CoexprRow, CourseSeries, SequencePanel, SequenceNodeKind, PlotData } from "./types.ts";
import { kindFigure, kindTitle } from "./figures/index.ts";
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "./svg-kit.ts";
export { esc, SERIES, type SvgOpts };

// ---------------------------------------------------------------------------

function survivalSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const curves = (v.curves || []) as KmCurve[];
  const incidence = v.display === "incidence";
  const L = 46, R = 12, T = 12, PLOT = 250;
  const legendH = 16 * curves.length + 6;
  const stats = v.logrank ? 18 : 0;
  const cap = caption(v.caveat || "", W, T + PLOT + legendH + stats + 8, p.muted);
  const H = T + PLOT + legendH + stats + cap.height + 16;
  const { tMax, step } = survivalAxis(curves, { cutoffMonths: v.cutoffMonths, tickMonths: v.tickMonths });
  const x = (t: number) => L + (W - L - R) * t / tMax;
  const y = (s: number) => T + PLOT * (1 - s);
  const out: string[] = [];
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line x1="${L}" y1="${num(y(s))}" x2="${W - R}" y2="${num(y(s))}" stroke="${p.line}" stroke-width="1"/>`);
    out.push(`<text x="8" y="${num(y(s) + 3)}" font-size="10" fill="${p.muted}">${Math.round(s * 100)}%</text>`);
  }
  for (let t = 0; t <= tMax; t += step)
    out.push(`<text x="${num(x(t) - 8)}" y="${T + PLOT + 14}" font-size="10" fill="${p.muted}">${t}mo</text>`);
  curves.forEach((c, i) => {
    // a step function: hold the previous level to the event time, then drop (rise, for incidence)
    let d = `M ${num(x(0))} ${num(y(incidence ? 0 : 1))}`, py = y(incidence ? 0 : 1);
    for (const q of c.points) { d += ` L ${num(x(q.t))} ${num(py)} L ${num(x(q.t))} ${num(y(q.s))}`; py = y(q.s); }
    d += ` L ${num(x(tMax))} ${num(py)}`;
    out.push(`<path d="${d}" fill="none" stroke="${SERIES[i % SERIES.length]}" stroke-width="2"/>`);
  });
  curves.forEach((c, i) => {
    const ly = T + PLOT + 24 + i * 16;
    out.push(`<rect x="8" y="${ly}" width="9" height="9" rx="2" fill="${SERIES[i % SERIES.length]}"/>`);
    out.push(`<text x="22" y="${ly + 8}" font-size="11" fill="${p.ink}">${esc(c.cohort)}: ` +
      `${incidence ? "50% incidence by " : "median "}${c.median == null ? "not reached" : num(c.median) + "mo"} (n=${fmt(c.n)}, ${fmt(c.events)} events)</text>`);
  });
  if (v.logrank) {
    const ly = T + PLOT + 24 + curves.length * 16;
    out.push(`<text x="8" y="${ly + 8}" font-size="11" fill="${p.ink}">log-rank χ²=${num(v.logrank.chi2)} ` +
      `(${v.logrank.df} df) · ${pFmt(v.logrank.p)}` +
      (v.logrank.strata > 1 ? ` · stratified by study, ${v.logrank.strata} strata` : "") + `</text>`);
  }
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

/** The lollipop standing alone (an MCP client's image): the selection applied, the app's controls in words in the caption. */
function hotspotsSvg(v: ViewResult, o: SvgOpts): string {
  const hide = (v.hide || []) as string[];
  const all = (v.hotspots || []) as HotspotGene[];
  return lollipopPanelsSvg(all.map((g) => filterHotspotGene(g, hide).gene), o,
    [v.note || "", lollipopSummaryText(all, hide)].filter(Boolean).join(" "));
}

/** Shared horizontal-bar figure: label, bar, value. */
function barsSvg(title: string, rows: { label: string; v: number; text: string; colour?: string; signed?: boolean }[],
  note: string, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const ROW = 18, LEFT = 190, RIGHT = 96, T = 22;
  const cap = caption(note, W, T + rows.length * ROW + 6, p.muted);
  const H = T + rows.length * ROW + cap.height + 12;
  const span = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const plotW = W - LEFT - RIGHT;
  const out = [`<text x="8" y="14" font-size="11" font-weight="600" fill="${p.ink}">${esc(title)}</text>`];
  rows.forEach((r, i) => {
    const y = T + i * ROW;
    out.push(`<text x="8" y="${y + 11}" font-size="10" fill="${p.ink}">${esc(r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label)}</text>`);
    const w = Math.max(1, (Math.abs(r.v) / span) * (r.signed ? plotW / 2 : plotW));
    const x = r.signed ? (r.v < 0 ? LEFT + plotW / 2 - w : LEFT + plotW / 2) : LEFT;
    out.push(`<rect x="${num(x)}" y="${y + 3}" width="${num(w)}" height="8" rx="2" fill="${r.colour || SERIES[0]}" opacity="0.8"/>`);
    if (r.signed) out.push(`<line x1="${LEFT + plotW / 2}" y1="${y + 1}" x2="${LEFT + plotW / 2}" y2="${y + 13}" stroke="${p.muted}" stroke-width="1" opacity="0.5"/>`);
    out.push(`<text x="${W - 8}" y="${y + 11}" font-size="10" fill="${p.muted}" text-anchor="end">${esc(r.text)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

function cooccurrenceSvg(v: ViewResult, o: SvgOpts): string {
  const pairs = ((v.pairs || []) as CooccurRow[]);
  return barsSvg("Co-occurrence — log₂ odds ratio", pairs.map((r) => {
    const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : (r.log2Odds ?? 0);
    return { label: r.a + " / " + r.b, v: lor, signed: true,
      colour: lor < 0 ? "#D55E00" : "#0072B2",
      text: num(lor) + "   " + pFmt(r.pStratified ?? r.p).replace("p=", "") };
  }), v.note || "", o);
}

function compareSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.rows || []) as CompareRow[]);
  const names = v.cohorts || [];
  const out: { label: string; v: number; text: string; colour?: string }[] = [];
  for (const r of rows)
    r.cells.forEach((c, ci) => out.push({
      label: (ci === 0 ? r.gene : ""), v: c.anyPct ?? 0, colour: SERIES[ci % SERIES.length],
      text: esc(names[ci] || c.cohort) + " " + (c.anyPct ?? 0) + "%"
    }));
  return barsSvg("Altered %, by cohort", out, v.note || "", o);
}

function coexpressionSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.coexpression || []) as CoexprRow[]);
  return barsSvg("Co-expression — Pearson r", rows.map((r) => {
    const rr = r.rMeta ?? r.r ?? 0;
    return { label: r.a + " / " + r.b, v: rr, signed: true,
      colour: rr < 0 ? "#D55E00" : "#0072B2", text: num(rr) + "   n=" + fmt(r.n) };
  }), v.note || "", o);
}

function clinicalSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.clinical || []) as ClinicalRow[]).filter((r) => !r.skipped);
  return barsSvg("Clinical comparison — −log₁₀ q", rows.map((r) => ({
    label: r.attribute, v: r.q ? Math.min(50, -Math.log10(Math.max(r.q, 1e-50))) : 0,
    text: r.test + "  q=" + (r.q == null ? "—" : r.q < 1e-4 ? r.q.toExponential(1) : r.q.toFixed(4))
  })), v.note || "", o);
}

/**
 * Render one view. Returns null when the view has no figure worth drawing —
 * an errored view, or one whose payload is empty — rather than an empty frame.
 */
/**
 * The clinical course: small multiples, one panel per event type, one line per
 * cohort. Two things the picture must not hide.
 *
 * The at-risk denominator is printed under the axis the way a KM figure prints
 * its risk table — a curve over 40 remaining patients should not look like a
 * curve over 24,000. It depends only on cohort and bin, never on event type, so
 * it is written once rather than per panel.
 *
 * And the line STOPS where fewer than RISK_FLOOR patients remain observable,
 * with the truncation stated rather than left to be inferred from a line that
 * simply gets noisy.
 */
export const RISK_FLOOR = 10;
function courseSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const series = (v.course || []) as CourseSeries[];
  const axis = v.courseAxis || { binMonths: 3, from: -12, to: 60 };
  const cohortNames = [...new Set(series.map((s) => s.cohort))];
  const panels = [...new Set(series.map((s) => s.eventType))];
  // Layout: each panel owns HEAD (its title) + PANEL (the plot) + FOOT (its axis
  // labels). Right padding must clear a centred "60mo" and a risk figure, both
  // of which sit ON the last tick rather than left of it.
  const L = 46, R = 30, T = 6, HEAD = 21, PANEL = 120, FOOT = 20;
  const BLOCK = HEAD + PANEL + FOOT;
  const riskH = 14 * cohortNames.length + 18;
  // Always legended, as survivalSvg is: rasterised into a chat the figure stands
  // alone, and one that does not name its cohort is anonymous.
  const legendH = 16 * cohortNames.length + 8;
  const plotsH = panels.length * BLOCK;
  const truncated = series.some((s) => s.points.some((q) => q.atRisk > 0 && q.atRisk < RISK_FLOOR));
  const foot = (truncated ? " Lines stop where fewer than " + RISK_FLOOR + " patients remain observable." : "");
  const cap = caption((v.caveat || "") + foot, W, T + plotsH + riskH + legendH + 6, p.muted);
  const H = T + plotsH + riskH + legendH + cap.height + 14;

  const x = (t: number) => L + (W - L - R) * (t - axis.from) / Math.max(1, axis.to - axis.from);
  const out: string[] = [];

  panels.forEach((et, pi) => {
    const top = T + pi * BLOCK + HEAD;
    const y = (pct: number) => top + PANEL * (1 - pct / 100);
    const isInterval = series.find((s) => s.eventType === et)?.isInterval;
    out.push(`<text x="8" y="${top - 5}" font-size="11" font-weight="600" fill="${p.ink}">${esc(et)}` +
      `<tspan font-weight="400" fill="${p.muted}"> — % ${isInterval ? "in this state" : "with an event"}</tspan></text>`);
    for (const pct of [0, 50, 100]) {
      out.push(`<line x1="${L}" y1="${num(y(pct))}" x2="${W - R}" y2="${num(y(pct))}" stroke="${p.line}" stroke-width="1"/>`);
      out.push(`<text x="8" y="${num(y(pct) + 3)}" font-size="10" fill="${p.muted}">${pct}%</text>`);
    }
    // The anchor is the whole point of the alignment, so mark t=0 explicitly.
    if (axis.from < 0) out.push(`<line x1="${num(x(0))}" y1="${top}" x2="${num(x(0))}" y2="${top + PANEL}" ` +
      `stroke="${p.muted}" stroke-width="1" stroke-dasharray="3 3"/>`);
    const step = axis.to - axis.from > 72 ? 24 : 12;
    for (let t = Math.ceil(axis.from / step) * step; t <= axis.to; t += step)
      out.push(`<text x="${num(x(t))}" y="${top + PANEL + 13}" font-size="10" text-anchor="middle" fill="${p.muted}">${t}mo</text>`);
    cohortNames.forEach((cn, ci) => {
      const s = series.find((z) => z.cohort === cn && z.eventType === et);
      if (!s) return;
      const pts = s.points.filter((q) => q.pct != null && q.atRisk >= RISK_FLOOR);
      if (!pts.length) return;
      out.push(`<path d="${pts.map((q, i) => (i ? "L" : "M") + " " + num(x(q.t)) + " " + num(y(q.pct!))).join(" ")}" ` +
        `fill="none" stroke="${SERIES[ci % SERIES.length]}" stroke-width="2"/>`);
    });
  });

  // Risk table: the denominator, printed. Sits below the last panel's own axis
  // labels (each block already reserves FOOT for those).
  const rt = T + plotsH + 10;
  out.push(`<text x="8" y="${rt}" font-size="10" fill="${p.muted}">patients still observable</text>`);
  const step = axis.to - axis.from > 72 ? 24 : 12;
  cohortNames.forEach((cn, ci) => {
    const s = series.find((z) => z.cohort === cn);
    const ry = rt + 13 + ci * 14;
    out.push(`<rect x="8" y="${ry - 7}" width="7" height="7" rx="1.5" fill="${SERIES[ci % SERIES.length]}"/>`);
    for (let t = Math.ceil(axis.from / step) * step; t <= axis.to; t += step) {
      const q = s?.points.find((z) => z.t === t);
      out.push(`<text x="${num(x(t))}" y="${ry}" font-size="9" text-anchor="middle" fill="${p.muted}">${q ? fmt(q.atRisk) : "-"}</text>`);
    }
  });
  cohortNames.forEach((cn, ci) => {
    const ly = rt + riskH + ci * 16;
    out.push(`<rect x="8" y="${ly - 8}" width="9" height="9" rx="2" fill="${SERIES[ci % SERIES.length]}"/>`);
    out.push(`<text x="22" y="${ly}" font-size="11" fill="${p.ink}">${esc(cn)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

/**
 * Treatment sequences as a Sankey: columns are lines of therapy, ribbons are
 * patients moving between them. One panel per cohort, stacked.
 *
 * ONE SCALE EVERYWHERE — across columns AND across panels. The second line being
 * visibly thinner than the first is the point, and so is one cohort being
 * smaller than the other; normalising either would hide exactly the attrition
 * and imbalance the chart exists to show.
 *
 * TWO KINDS OF ENDING, drawn differently. A path that ends because the study
 * watched and saw no further therapy is a finding; a path that ends because the
 * record stops is an artefact. Merging them into one grey block — which is what
 * this chart did before the fates were measured — makes censoring look like a
 * clinical decision, and censoring is usually the bigger share.
 */
const SEQ_STOPPED = "#8fa3ae";
const SEQ_CENSORED = "#c8ced2";
function sequenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const sq = v.sequence!;
  const panels = sq.panels;
  const L = 8, R = 8, NODE_W = 13, GAP = 6, PANEL_H = 270, HEAD = 30, PANEL_GAP = 22;
  const cols = [...new Set(panels.flatMap((pn) => pn.nodes.map((n) => n.column)))].sort((a, b) => a - b);

  // One scale for every panel: the biggest column anywhere fills PANEL_H.
  const colTotal = (pn: SequencePanel, c: number) =>
    pn.nodes.filter((n) => n.column === c).reduce((t, n) => t + n.n, 0);
  const maxTotal = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => colTotal(pn, c))));
  const maxCount = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => pn.nodes.filter((n) => n.column === c).length)));
  const scale = (PANEL_H - GAP * (maxCount - 1)) / maxTotal;

  // Colour follows the regimen globally, so a label means the same thing in
  // every column and every panel.
  const ranked = [...new Set(panels.flatMap((pn) => pn.nodes)
    .filter((n) => n.kind === "regimen" && n.label !== "other")
    .sort((a, b) => b.n - a.n).map((n) => n.label))];
  const colourOf = (kind: SequenceNodeKind, label: string) =>
    kind === "stopped" ? SEQ_STOPPED : kind === "censored" ? SEQ_CENSORED
      : label === "other" ? "#9aa7b0" : SERIES[ranked.indexOf(label) % SERIES.length];
  const nameOf = (kind: SequenceNodeKind, label: string) =>
    kind === "stopped" ? "no further line" : kind === "censored" ? "record ends here" : label;

  const colX = (c: number) => cols.length < 2 ? L
    : L + (W - L - R - NODE_W) * (cols.indexOf(c) / (cols.length - 1));
  const bodyH = panels.length * (HEAD + PANEL_H) + (panels.length - 1) * PANEL_GAP;
  const cap = caption(v.caveat || "", W, bodyH + 30, p.muted);
  const H = bodyH + 30 + cap.height + 12;

  const out: string[] = [];
  panels.forEach((pn, pi) => {
    const top = pi * (HEAD + PANEL_H + PANEL_GAP) + HEAD;
    out.push(`<text x="8" y="${top - 16}" font-size="11" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
      `<tspan font-weight="400" fill="${p.muted}"> \u2014 ${fmt(pn.started)} with a first line, ` +
      `${pn.started ? Math.round(100 * pn.censored / pn.started) : 0}% of paths censored</tspan></text>`);
    for (const c of cols) {
      const last = c === cols[cols.length - 1];
      out.push(`<text x="${num(last ? colX(c) + NODE_W : colX(c))}" y="${top - 4}" font-size="9.5" ` +
        `text-anchor="${last ? "end" : "start"}" fill="${p.muted}">` +
        (c <= sq.steps ? `line ${c}` : `line ${c}+`) + `</text>`);
    }

    // Regimens biggest-first, then the two terminals at the bottom: they are
    // usually the largest nodes, and sorting them by size would shove every
    // continuing regimen down and cross most of the ribbons.
    const rank = (k: SequenceNodeKind) => k === "regimen" ? 0 : k === "stopped" ? 1 : 2;
    const box = new Map<string, { x: number; y: number; h: number }>();
    for (const c of cols) {
      const list = pn.nodes.filter((n) => n.column === c)
        .sort((a, b) => rank(a.kind) - rank(b.kind) || b.n - a.n);
      let y = top;
      for (const n of list) {
        const h = Math.max(1, n.n * scale);
        box.set(c + "\u0000" + n.kind + "\u0000" + n.label, { x: colX(c), y, h });
        y += h + GAP;
      }
    }

    const outOff = new Map<string, number>(), inOff = new Map<string, number>();
    for (const f of [...pn.flows].sort((a, b) => a.column - b.column || rank(a.kind) - rank(b.kind) || b.n - a.n)) {
      const ka = f.column + "\u0000regimen\u0000" + f.from;
      const kb = (f.column + 1) + "\u0000" + f.kind + "\u0000" + f.to;
      const a = box.get(ka), b = box.get(kb);
      if (!a || !b) continue;
      const h = Math.max(0.6, f.n * scale);
      const y0 = a.y + (outOff.get(ka) || 0), y1 = b.y + (inOff.get(kb) || 0);
      outOff.set(ka, (outOff.get(ka) || 0) + h);
      inOff.set(kb, (inOff.get(kb) || 0) + h);
      const x0 = a.x + NODE_W, x1 = b.x, xm = (x0 + x1) / 2;
      const colour = f.kind === "regimen" ? colourOf("regimen", f.from) : colourOf(f.kind, "");
      out.push(`<path d="M ${num(x0)} ${num(y0)} C ${num(xm)} ${num(y0)}, ${num(xm)} ${num(y1)}, ${num(x1)} ${num(y1)} ` +
        `L ${num(x1)} ${num(y1 + h)} C ${num(xm)} ${num(y1 + h)}, ${num(xm)} ${num(y0 + h)}, ${num(x0)} ${num(y0 + h)} Z" ` +
        `fill="${colour}" fill-opacity="${f.kind === "regimen" ? 0.32 : 0.45}"/>`);
    }

    for (const n of pn.nodes) {
      const bx = box.get(n.column + "\u0000" + n.kind + "\u0000" + n.label);
      if (!bx) continue;
      out.push(`<rect x="${num(bx.x)}" y="${num(bx.y)}" width="${NODE_W}" height="${num(bx.h)}" rx="2" ` +
        `fill="${colourOf(n.kind, n.label)}"/>`);
      if (bx.h >= 11) {
        const last = bx.x + NODE_W > W - 150;
        const text = nameOf(n.kind, n.label) + " " + fmt(n.n);
        out.push(`<text x="${num(last ? bx.x - 5 : bx.x + NODE_W + 5)}" y="${num(bx.y + bx.h / 2 + 3)}" ` +
          `font-size="9.5" text-anchor="${last ? "end" : "start"}" fill="${p.ink}">${esc(text)}</text>`);
      }
    }
  });

  // Legend for the two terminals: their difference is the whole point, and a
  // reader must not have to infer it from two shades of grey.
  const ly = bodyH + 14;
  [["no further line \u2014 watched, none started", SEQ_STOPPED],
   ["record ends here \u2014 nothing can be concluded", SEQ_CENSORED]].forEach(([t, c], i) => {
    out.push(`<rect x="${8 + i * 300}" y="${ly - 8}" width="9" height="9" rx="2" fill="${c}"/>`);
    out.push(`<text x="${22 + i * 300}" y="${ly}" font-size="9.5" fill="${p.muted}">${esc(t)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

/**
 * A plot, from the aggregated contract: a density field for a scatter, boxes for a numeric
 * axis grouped by a categorical one, a shaded contingency for two categoricals.
 *
 * Nothing here has ever seen a point. The cells, the quartiles and the coefficients arrive
 * already computed, which is why the same picture draws for a hundred cases or four hundred
 * thousand.
 */
function plotSvg(v: ViewResult, o: SvgOpts): string {
  const d = v.plot as PlotData | undefined;
  if (!d) return "";
  const p = palette(o.theme), W = o.width || 960;
  const L = 60, R = 14, T = 16, PLOT = 300;
  const plotW = W - L - R;
  const out: string[] = [];
  const axisText = (t: string, x: number, y: number, anchor = "middle", size = 11) =>
    `<text x="${num(x)}" y="${num(y)}" font-size="${size}" fill="${p.muted}" text-anchor="${anchor}">${esc(t)}</text>`;

  if (d.shape === "scatter" && d.bins && d.extent && d.grid) {
    const { x0, x1, y0, y1 } = d.extent, [gx, gy] = d.grid;
    const maxN = Math.max(1, ...d.bins.map((b) => b.n));
    const cw = plotW / gx, ch = PLOT / gy;
    // a log ramp, because a linear one hides everything but the mode — said on the figure
    const shade = (n: number) => Math.min(1, 0.18 + 0.82 * Math.log1p(n) / Math.log1p(maxN));
    for (const b of d.bins)
      out.push(`<rect x="${num(L + b.bx * cw)}" y="${num(T + PLOT - (b.by + 1) * ch)}" width="${num(Math.max(cw, 0.8))}" ` +
        `height="${num(Math.max(ch, 0.8))}" fill="${SERIES[0]}" fill-opacity="${num(shade(b.n))}"/>`);
    // the fitted line, over every case rather than over what is visible
    const st = d.stats;
    if (st && st.slope != null && st.intercept != null && x1 > x0) {
      const yAt = (xv: number) => st.intercept! + st.slope! * xv;
      const sx = (xv: number) => L + plotW * (xv - x0) / (x1 - x0);
      const sy = (yv: number) => T + PLOT - PLOT * (yv - y0) / Math.max(1e-9, y1 - y0);
      const ya = Math.max(y0, Math.min(y1, yAt(x0))), yb = Math.max(y0, Math.min(y1, yAt(x1)));
      out.push(`<line x1="${num(sx(x0))}" y1="${num(sy(ya))}" x2="${num(sx(x1))}" y2="${num(sy(yb))}" ` +
        `stroke="${SERIES[4]}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    }
    out.push(`<rect x="${L}" y="${T}" width="${num(plotW)}" height="${PLOT}" fill="none" stroke="${p.line}"/>`);
    out.push(axisText(num(x0), L, T + PLOT + 14, "start"), axisText(num(x1), L + plotW, T + PLOT + 14, "end"));
    out.push(axisText(num(y0), L - 6, T + PLOT, "end"), axisText(num(y1), L - 6, T + 10, "end"));
    if (st) {
      const line = (st.pearson != null ? "Pearson " + num(st.pearson) + " (" + pFmt(st.pPearson ?? 1) + ")" : "") +
        (st.spearman != null ? "   Spearman " + num(st.spearman) + " (" + pFmt(st.pSpearman ?? 1) + ")" : "");
      out.push(`<text x="${W - R}" y="${T + 12}" font-size="11" fill="${p.ink}" text-anchor="end">${esc(line)}</text>`);
    }
    out.push(axisText(d.x.label, L + plotW / 2, T + PLOT + 30), 
      `<text x="14" y="${T + PLOT / 2}" font-size="11" fill="${p.muted}" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${T + PLOT / 2})">${esc(d.y.label)}</text>`);
    const cap = caption((v.note || "") + (v.note ? "  " : "") + "Darker is more " +
      (v.plot!.n > 1 ? "cases" : "case") + "; the shade is logarithmic.", W, T + PLOT + 40, p.muted);
    return frame(W, T + PLOT + 40 + cap.height + 10, out.join("") + cap.svg, p.bg);
  }

  if (d.shape === "box" && d.groups && d.groups.length) {
    // Every group is drawn. Past what fits at the requested width the figure widens (and the
    // app's container scrolls) rather than dropping the smaller groups, whose cases would
    // otherwise be missing from a figure that still claims the full count.
    const gs = d.groups;
    const MIN_BW = 26;
    const Wb = Math.max(W, L + R + gs.length * MIN_BW), plotWb = Wb - L - R;
    const lo = Math.min(...gs.map((g) => g.loWhisker)), hi = Math.max(...gs.map((g) => g.hiWhisker));
    const span = Math.max(1e-9, hi - lo);
    const bw = plotWb / gs.length;
    const sy = (val: number) => T + PLOT - PLOT * (val - lo) / span;
    // the values behind the boxes: every point when the reader may see cases and there are few
    // enough of them, otherwise the density of the same values
    const byGroup = new Map<string, { id: string; v: number; c?: string; r?: string }[]>();
    for (const pt of d.points || [])
      (byGroup.get(pt.g) ?? byGroup.set(pt.g, []).get(pt.g)!).push({ id: pt.id, v: pt.v, c: pt.c, r: pt.r });
    // each violin is scaled to its OWN densest bin: one group holding 178,489 of the values
    // would otherwise flatten every other group to an invisible sliver. How many cases a group
    // has is already printed under its name, so the width is free to describe its shape.
    // a bin may hold several colour classes; the totals are what the width is scaled by
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
    const colorKey = (d.legend || []).filter((k) => !k.ring);
    const ringKey = (d.legend || []).filter((k) => k.ring);
    const byLabel = new Map((d.legend || []).map((k) => [k.label, k.color]));
    // The key names the commonest COLOR_CAP categories. Everything past it — and a case with no
    // value — is one grey "other" with a key entry of its own, rather than a colour nobody can
    // look up (points) or a gap in the violin where its share should be.
    const OTHER = "#9aa5ad";
    const fillKeyed = new Set(colorKey.map((k) => k.label)), ringKeyed = new Set(ringKey.map((k) => k.label));
    const fillOthers = new Set<string>(), ringOthers = new Set<string>();
    let fillNoValue = false;
    for (const b of d.violin || []) if (b.c != null && !fillKeyed.has(b.c)) { if (b.c === "") fillNoValue = true; else fillOthers.add(b.c); }
    for (const pt of d.points || []) {
      if (pt.c != null && !fillKeyed.has(pt.c)) { if (pt.c === "") fillNoValue = true; else fillOthers.add(pt.c); }
      if (pt.r != null && !isAbsent(pt.r) && !ringKeyed.has(pt.r)) ringOthers.add(pt.r);
    }
    const fillOf = (label: string) => fillKeyed.has(label) ? byLabel.get(label)! : OTHER;
    const ringOf = (label: string) => ringKeyed.has(label) ? byLabel.get(label)! : OTHER;
    const otherLabel = (n: number, noValue: boolean) =>
      "other (" + [n ? n + " more categor" + (n === 1 ? "y" : "ies") : "", noValue ? "no value" : ""].filter(Boolean).join(", ") + ")";
    const vBins = d.violinBins || 40;

    gs.forEach((g, i) => {
      const cx = L + bw * (i + 0.5), half = Math.min(24, bw * 0.32);
      if (d.overlay === "violin" && vio.has(g.g)) {
        // a half-width density either side of the box, each violin scaled to its own densest bin.
        // With a colour, one bin's width is shared out between its classes, so the split is
        // visible without pretending the classes were measured separately.
        const cells = vio.get(g.g)!;
        // a bin stands for a range of VALUES, and the axis is drawn between the whiskers, so the
        // two are mapped through the extent the bins were cut over rather than assumed equal
        const [vx0, vx1] = d.violinExtent || [lo, hi];
        const bw = (vx1 - vx0) / vBins;
        for (const [b, byClass] of cells) {
          const vLo = vx0 + b * bw, vHi = vLo + bw;
          if (vHi < lo || vLo > hi) continue;
          const total = [...byClass.values()].reduce((a, n) => a + n, 0);
          const w = half * 1.6 * Math.sqrt(total / (vioMax.get(g.g) || 1));
          const yTop = sy(Math.min(hi, vHi));
          const step = Math.max(1.2, sy(Math.max(lo, vLo)) - yTop);
          if (!colorKey.length) {
            out.push(`<rect x="${num(cx - w)}" y="${num(yTop)}" width="${num(w * 2)}" height="${num(step)}" ` +
              `fill="${SERIES[0]}" fill-opacity="0.28"/>`);
            continue;
          }
          let x = cx - w;
          const segs = colorKey.map((k) => ({ n: byClass.get(k.label) || 0, color: k.color }));
          segs.push({ n: [...byClass.entries()].reduce((a, [c, n]) => fillKeyed.has(c) ? a : a + n, 0), color: OTHER });
          for (const sg of segs) {
            if (!sg.n) continue;
            const seg = 2 * w * (sg.n / total);
            out.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(seg)}" height="${num(step)}" ` +
              `fill="${sg.color}" fill-opacity="0.75"/>`);
            x += seg;
          }
        }
      }
      if (d.overlay === "points" && byGroup.has(g.g)) {
        // two encodings on one dot need a dot big enough to carry them; a crowded plot gets
        // smaller ones so the cloud is still a cloud
        const nPts = d.points!.length;
        const rBase = Math.max(1.3, Math.min(4.5, 90 / Math.sqrt(Math.max(1, nPts))));
        for (const pt of byGroup.get(g.g)!) {
          const fill = pt.c != null && colorKey.length ? fillOf(pt.c) : SERIES[0];
          const ring = pt.r != null && !isAbsent(pt.r) ? ringOf(pt.r) : null;
          out.push(`<circle cx="${num(cx + jitterFor(pt.id) * half * 0.9)}" cy="${num(sy(pt.v))}" ` +
            `r="${num(ring ? rBase * 1.25 : rBase)}" fill="${fill}" fill-opacity="0.85"` +
            (ring ? ` stroke="${ring}" stroke-width="${num(Math.max(0.6, rBase * 0.28))}"` : "") + `/>`);
        }
      }
      out.push(`<line x1="${num(cx)}" y1="${num(sy(g.loWhisker))}" x2="${num(cx)}" y2="${num(sy(g.hiWhisker))}" stroke="${p.muted}"/>`);
      out.push(`<rect x="${num(cx - half)}" y="${num(sy(g.q3))}" width="${num(half * 2)}" height="${num(Math.max(1, sy(g.q1) - sy(g.q3)))}" ` +
        `fill="${SERIES[0]}" fill-opacity="${d.overlay === "none" ? 0.25 : 0.1}" stroke="${SERIES[0]}"/>`);
      out.push(`<line x1="${num(cx - half)}" y1="${num(sy(g.median))}" x2="${num(cx + half)}" y2="${num(sy(g.median))}" stroke="${SERIES[0]}" stroke-width="2"/>`);
      const label = g.g.length > 14 ? g.g.slice(0, 13) + "…" : g.g;
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 26}" font-size="9" fill="${p.muted}" text-anchor="end" ` +
        `transform="rotate(-40 ${num(cx)} ${T + PLOT + 26})">${esc(label)}</text>`);
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 12}" font-size="8" fill="${p.muted}" text-anchor="middle">${fmt(g.n)}</text>`);
    });
    for (const t of [lo, (lo + hi) / 2, hi]) out.push(axisText(num(t), L - 6, sy(t) + 3, "end", 10));
    out.push(`<rect x="${L}" y="${T}" width="${num(plotWb)}" height="${PLOT}" fill="none" stroke="${p.line}"/>`);
    // Whichever of x/y the document names as the numeric one, the box is always drawn grouped
    // by the categorical axis with the numeric axis vertical — so the two attribute names are
    // the only way to tell a reader which is which; without them a swapped x/y is invisible.
    const numLabel = d.x.kind === "num" ? d.x.label : d.y.label, catLabel = d.x.kind === "num" ? d.y.label : d.x.label;
    out.push(axisText(catLabel, L + plotWb / 2, T + PLOT + 46),
      `<text x="14" y="${T + PLOT / 2}" font-size="11" fill="${p.muted}" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${T + PLOT / 2})">${esc(numLabel)}</text>`);
    let keyY = T + PLOT + 74;
    if (colorKey.length || ringKey.length) {
      let kx = L;
      const chip = (k: { label: string; color: string; ring?: boolean }) => {
        const w = 12 + k.label.length * 5.4;
        if (kx + w > Wb - R) { kx = L; keyY += 14; }
        const g = k.ring
          ? `<circle cx="${num(kx + 4)}" cy="${num(keyY - 3)}" r="3.4" fill="none" stroke="${k.color}" stroke-width="1.6"/>`
          : `<circle cx="${num(kx + 4)}" cy="${num(keyY - 3)}" r="3.4" fill="${k.color}"/>`;
        out.push(g + `<text x="${num(kx + 11)}" y="${num(keyY)}" font-size="9" fill="${p.muted}">${esc(k.label)}</text>`);
        kx += w;
      };
      if (colorKey.length) { out.push(`<text x="${L}" y="${num(keyY - 14)}" font-size="9" fill="${p.muted}">${esc(d.colorLabel || "colour")}</text>`); colorKey.forEach(chip);
        if (fillOthers.size || fillNoValue) chip({ label: otherLabel(fillOthers.size, fillNoValue), color: OTHER }); }
      // a ring means "this case also has that", so absence gets no ring and no key entry
      if (ringKey.some((k) => !isAbsent(k.label))) {
        kx = L; keyY += 16;
        out.push(`<text x="${L}" y="${num(keyY - 14)}" font-size="9" fill="${p.muted}">${esc(d.ringLabel || "ring")}</text>`);
        ringKey.filter((k) => !isAbsent(k.label)).forEach(chip);
        if (ringOthers.size) chip({ label: otherLabel(ringOthers.size, false), color: OTHER, ring: true });
      }
      keyY += 8;
    }
    // the engine's note leads, as it does under the scatter — it is where the view says what it
    // drew over (and what it had to leave out), so a box plot without it hid exactly that
    const cap = caption((v.note ? v.note + "  " : "") + "Box: quartiles with Tukey whiskers, computed over every case in the group. The count is above each name." +
      (d.overlay === "points" ? " Every value is drawn over its box; the jitter is fixed per case."
        : d.overlay === "violin" ? " The shaded width is the share of that group's values sitting at that height, scaled per group."
        : ""),
      Wb, Math.max(T + PLOT + 84, keyY), p.muted);
    const bottom = Math.max(T + PLOT + 84, keyY);
    return frame(Wb, bottom + cap.height + 10, out.join("") + cap.svg, p.bg, Wb > W);
  }

  if (d.shape === "table" && d.cells && d.cells.length) {
    // Every category on both axes — the engine refuses a pair past CATEGORY_CAP, so what arrives
    // is already the whole table, and a table missing rows or columns is a wrong one.
    // Ordered by marginal total so the big categories still read first.
    const marg = (key: "cx" | "cy") => {
      const t = new Map<string, number>();
      for (const c of d.cells!) t.set(c[key], (t.get(c[key]) || 0) + c.n);
      return [...t.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
    };
    const xs = marg("cx"), ys = marg("cy");
    const at = new Map(d.cells.map((c) => [c.cx + "\u0000" + c.cy, c.n]));
    const maxN = Math.max(1, ...d.cells.map((c) => c.n));
    const LX = 130, MIN_CW = 30, MIN_CH = 16;
    const Wt = Math.max(W, LX + R + xs.length * MIN_CW);
    const cw = (Wt - LX - R) / xs.length, chh = Math.max(MIN_CH, Math.min(30, PLOT / Math.max(1, ys.length)));
    ys.forEach((yv, r) => {
      out.push(`<text x="${LX - 6}" y="${num(T + chh * r + chh * 0.66)}" font-size="10" fill="${p.muted}" text-anchor="end">${esc(yv.length > 20 ? yv.slice(0, 19) + "…" : yv)}</text>`);
      xs.forEach((xv, c) => {
        const n = at.get(xv + "\u0000" + yv) || 0;
        out.push(`<rect x="${num(LX + cw * c)}" y="${num(T + chh * r)}" width="${num(cw - 1)}" height="${num(chh - 1)}" ` +
          `fill="${SERIES[0]}" fill-opacity="${num(n ? 0.12 + 0.78 * Math.log1p(n) / Math.log1p(maxN) : 0.03)}"/>`);
        if (n) out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * r + chh * 0.66)}" font-size="9" ` +
          `fill="${p.ink}" text-anchor="middle">${fmt(n)}</text>`);
      });
    });
    xs.forEach((xv, c) => out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * ys.length + 12)}" font-size="9" ` +
      `fill="${p.muted}" text-anchor="end" transform="rotate(-40 ${num(LX + cw * (c + 0.5))} ${num(T + chh * ys.length + 12)})">${esc(xv.length > 16 ? xv.slice(0, 15) + "…" : xv)}</text>`));
    const h = T + chh * ys.length + 86;
    const cap = caption((v.note ? v.note + "  " : "") + d.x.label + " across, " + d.y.label + " down. " + fmt(d.n) + " cases counted in the database.", Wt, h, p.muted);
    return frame(Wt, h + cap.height + 10, out.join("") + cap.svg, p.bg, Wt > W);
  }
  return "";
}

/**
 * A forest plot's shared body: N panels (one per cohort, when stratified — otherwise just one),
 * all sharing ONE ratio scale computed across every panel together, so effect sizes are directly
 * comparable at a glance. `refLabel` names what ratio=1 means ("HR=1" for Cox, "OR=1" for
 * logistic) — everything else about a hazard ratio and an odds ratio's forest plot is identical.
 */
function forestBody(
  panels: { heading: string | null; coefs: { label: string; reference?: string; ciLow: number; ciHigh: number; ratio: number; p: number }[] }[],
  W: number, p: ReturnType<typeof palette>, refLabel: string
): { svg: string; bottom: number } {
  const L = 175, R = 215, rowH = 22, panelGap = 26;
  const allRatio = panels.flatMap((pn) => pn.coefs).flatMap((c) => [c.ciLow, c.ciHigh, c.ratio, 1]).filter((n) => Number.isFinite(n) && n > 0);
  const lo = Math.max(1e-3, Math.min(...allRatio) * 0.85), hi = Math.max(...allRatio) * 1.15;
  const lLo = Math.log(lo), lHi = Math.log(Math.max(hi, lo * 1.01));
  const x = (r: number) => L + (W - L - R) * (Math.log(Math.max(r, 1e-6)) - lLo) / (lHi - lLo);
  const out: string[] = [];
  let y = 30;
  panels.forEach((pn) => {
    const panelTop = y;
    if (pn.heading) {
      out.push(`<text x="${L - 10}" y="${num(y - 6)}" font-size="11" fill="${p.ink}" text-anchor="end" font-weight="600">${esc(pn.heading)}</text>`);
    }
    const plotH = rowH * pn.coefs.length;
    out.push(`<line x1="${num(x(1))}" y1="${panelTop - 10}" x2="${num(x(1))}" y2="${num(panelTop + plotH)}" stroke="${p.line}" stroke-width="1" stroke-dasharray="3,3"/>`);
    if (panelTop === 30) out.push(`<text x="${num(x(1))}" y="${panelTop - 14}" font-size="10" fill="${p.muted}" text-anchor="middle">${esc(refLabel)}</text>`);
    pn.coefs.forEach((c, i) => {
      const cy = panelTop + rowH * i + rowH / 2;
      const label = c.label + (c.reference ? " vs " + c.reference : "");
      out.push(`<text x="${L - 10}" y="${num(cy + 3)}" font-size="11" fill="${p.ink}" text-anchor="end">` +
        `${esc(label.length > 26 ? label.slice(0, 25) + "…" : label)}</text>`);
      out.push(`<line x1="${num(x(c.ciLow))}" y1="${num(cy)}" x2="${num(x(c.ciHigh))}" y2="${num(cy)}" stroke="${SERIES[0]}" stroke-width="2"/>`);
      out.push(`<circle cx="${num(x(c.ratio))}" cy="${num(cy)}" r="4" fill="${SERIES[0]}"/>`);
      out.push(`<text x="${num(W - R + 10)}" y="${num(cy + 3)}" font-size="10" fill="${p.muted}">` +
        `${num(c.ratio)} (${num(c.ciLow)}–${num(c.ciHigh)}), ${pFmt(c.p)}</text>`);
    });
    y = panelTop + plotH + panelGap;
  });
  return { svg: out.join(""), bottom: y - panelGap };
}

/** A forest plot: one row per covariate/level, its hazard ratio and Wald CI on a log axis. */
function coxSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 760;
  const byCohort = v.cox?.byCohort;
  // stratifyByCohort: one panel per cohort that fit, sharing forestBody's one scale — the
  // whole point of stratifying is seeing where cohorts agree or disagree at a glance.
  const panels = byCohort
    ? byCohort.filter((c) => c.coefficients.length).map((c) => ({ heading: c.cohort + " (n=" + c.n + ", " + c.events + " events)", coefs: c.coefficients.map((cf) => ({ ...cf, ratio: cf.hr })) }))
    : [{ heading: null as string | null, coefs: (v.cox?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.hr })) }];
  const body = forestBody(panels, W, p, "HR=1");
  const cap = caption(v.caveat || "", W, body.bottom + 20, p.muted);
  const H = body.bottom + 20 + cap.height + 16;
  return frame(W, H, body.svg + cap.svg, p.bg);
}

/** Same forest-plot shape as coxSvg, but for an odds ratio: one panel, no stratifyByCohort yet. */
function logisticSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 760;
  const panels = [{ heading: null as string | null, coefs: (v.logistic?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.or })) }];
  const body = forestBody(panels, W, p, "OR=1");
  const cap = caption(v.caveat || "", W, body.bottom + 20, p.muted);
  const H = body.bottom + 20 + cap.height + 16;
  return frame(W, H, body.svg + cap.svg, p.bg);
}

export function viewToSvg(v: ViewResult, o: SvgOpts = {}): string | null {
  if (!v || v.error) return null;
  if (v.kind === "oncoprint") return v.svg || null;   // already rendered by the contract
  if (v.kind === "plot" && v.plot) return plotSvg(v, o) || null;
  if (v.kind === "course" && v.course && v.course.length) return courseSvg(v, o);
  if (v.kind === "sequence" && v.sequence && v.sequence.panels.some((z) => z.flows.length)) return sequenceSvg(v, o);
  if (v.kind === "survival" && v.curves && v.curves.length) return survivalSvg(v, o);
  if (v.kind === "cox" && v.cox && (v.cox.coefficients.length || (v.cox.byCohort || []).some((c) => c.coefficients.length))) return coxSvg(v, o);
  if (v.kind === "logistic" && v.logistic && v.logistic.coefficients.length) return logisticSvg(v, o);
  if (v.kind === "hotspots" && v.hotspots && v.hotspots.length) return hotspotsSvg(v, o);
  if (v.kind === "cooccurrence" && v.pairs && v.pairs.length) return cooccurrenceSvg(v, o);
  if (v.kind === "compare" && v.rows && v.rows.length) return compareSvg(v, o);
  if (v.kind === "coexpression" && v.coexpression && v.coexpression.length) return coexpressionSvg(v, o);
  if (v.kind === "clinical" && v.clinical && v.clinical.some((r) => !r.skipped)) return clinicalSvg(v, o);
  return kindFigure(v, o);
}

/** A one-line title for a figure, for alt text and chat captions. */
export function viewTitle(v: ViewResult): string {
  const c = (v.cohorts || []).join(" vs ");
  const base = v.kind === "survival" ? (v.endpoint || "OS") + " survival" + (v.anchoredTo ? " from " + v.anchoredTo : "")
    : v.kind === "cox" ? "Cox regression — " + (v.endpoint || "OS")
    : v.kind === "logistic" ? "Logistic regression"
    : v.kind === "hotspots" ? "Recurrent protein changes"
    : v.kind === "cooccurrence" ? "Co-occurrence and mutual exclusivity"
    : v.kind === "coexpression" ? "Co-expression"
    : v.kind === "clinical" ? "Clinical comparison"
    : v.kind === "sequence" ? "Treatment sequence" +
        (v.sequence ? " by " + v.sequence.labelKey : "")
    : v.kind === "course" ? "Clinical course" +
        (v.course && v.course.length ? " — " + [...new Set(v.course.map((z) => z.eventType))].join(", ") : "")
    : v.kind === "compare" ? "Alteration frequencies"
    : v.kind === "oncoprint" ? "Oncoprint"
    : v.kind === "timeline" ? "Patient timeline" + (v.timeline?.patient ? " — " + v.timeline.patient.patient : "")
    : v.kind === "alterations" ? "Patient alterations" + (v.alterations?.patient ? " — " + v.alterations.patient.id : "")
    : kindTitle(v) || v.kind;
  return c ? base + " — " + c : base;
}
