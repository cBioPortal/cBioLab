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
import type { ViewResult, KmCurve, CooccurRow, HotspotGene, CompareRow, ClinicalRow, CoexprRow, CourseSeries, SequencePanel, SequenceNodeKind, PlotData } from "./types.ts";

/** Cohort names and data values reach <text>; they must never reach it raw. */
export const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SERIES = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
const INK = "var(--ink, #16232b)";
const MUTED = "var(--muted, #5b6b76)";
const LINE = "var(--line, #dde4e8)";
const BG = "var(--bg, #ffffff)";

export interface SvgOpts { width?: number; theme?: "auto" | "light" }

/** Palette resolution: "light" bakes literals in, for rasterising outside the app. */
function palette(theme: SvgOpts["theme"]) {
  return theme === "light"
    ? { ink: "#16232b", muted: "#5b6b76", line: "#dde4e8", bg: "#ffffff" }
    : { ink: INK, muted: MUTED, line: LINE, bg: BG };
}

const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const fmt = (n: number): string => n.toLocaleString("en-US");
const pFmt = (p: number): string => p === 0 ? "p < 1e-300" : p < 1e-4 ? "p=" + p.toExponential(1) : "p=" + p.toFixed(4);

function frame(w: number, h: number, body: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" ` +
    `style="max-width:${w}px;height:auto;display:block;font-family:'IBM Plex Sans',system-ui,sans-serif">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

/** Wrapped caption lines — the caveat travels WITH the figure, never separately. */
function caption(text: string, w: number, y0: number, muted: string, perLine = 96, maxLines = 6): { svg: string; height: number } {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > perLine) { lines.push(line.trim()); line = word; }
    else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  const capped = lines.slice(0, maxLines);
  return {
    svg: capped.map((l, i) => `<text x="8" y="${y0 + 12 + i * 13}" font-size="10" fill="${muted}">${esc(l)}</text>`).join(""),
    height: capped.length * 13 + 8
  };
}

// ---------------------------------------------------------------------------

function survivalSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const curves = (v.curves || []) as KmCurve[];
  const L = 46, R = 12, T = 12, PLOT = 250;
  const legendH = 16 * curves.length + 6;
  const stats = v.logrank ? 18 : 0;
  const cap = caption(v.caveat || "", W, T + PLOT + legendH + stats + 8, p.muted);
  const H = T + PLOT + legendH + stats + cap.height + 16;
  const tMax = Math.max(12, ...curves.flatMap((c) => c.points.map((q) => q.t)));
  const x = (t: number) => L + (W - L - R) * t / tMax;
  const y = (s: number) => T + PLOT * (1 - s);
  const out: string[] = [];
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line x1="${L}" y1="${num(y(s))}" x2="${W - R}" y2="${num(y(s))}" stroke="${p.line}" stroke-width="1"/>`);
    out.push(`<text x="8" y="${num(y(s) + 3)}" font-size="10" fill="${p.muted}">${Math.round(s * 100)}%</text>`);
  }
  const step = tMax > 60 ? 24 : 12;
  for (let t = 0; t <= tMax; t += step)
    out.push(`<text x="${num(x(t) - 8)}" y="${T + PLOT + 14}" font-size="10" fill="${p.muted}">${t}mo</text>`);
  curves.forEach((c, i) => {
    // a step function: hold the previous level to the event time, then drop
    let d = `M ${num(x(0))} ${num(y(1))}`, py = y(1);
    for (const q of c.points) { d += ` L ${num(x(q.t))} ${num(py)} L ${num(x(q.t))} ${num(y(q.s))}`; py = y(q.s); }
    d += ` L ${num(x(tMax))} ${num(py)}`;
    out.push(`<path d="${d}" fill="none" stroke="${SERIES[i % SERIES.length]}" stroke-width="2"/>`);
  });
  curves.forEach((c, i) => {
    const ly = T + PLOT + 24 + i * 16;
    out.push(`<rect x="8" y="${ly}" width="9" height="9" rx="2" fill="${SERIES[i % SERIES.length]}"/>`);
    out.push(`<text x="22" y="${ly + 8}" font-size="11" fill="${p.ink}">${esc(c.cohort)}: median ` +
      `${c.median == null ? "not reached" : num(c.median) + "mo"} (n=${fmt(c.n)}, ${fmt(c.events)} events)</text>`);
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

function hotspotsSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const genes = (v.hotspots || []) as HotspotGene[];
  const ROW = 96, PAD = 8;
  const cap = caption(v.note || "", W, PAD + genes.length * ROW + 4, p.muted);
  const H = PAD + genes.length * ROW + cap.height + 12;
  const out: string[] = [];
  genes.forEach((g, gi) => {
    const top = PAD + gi * ROW;
    const positioned = g.variants.filter((x) => x.pos != null);
    const maxPos = Math.max(1, ...positioned.map((x) => x.pos!));
    const rawStep = maxPos / 4, mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
    const stepv = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((z) => z >= rawStep) ?? mag * 10);
    const axisMax = Math.ceil(maxPos / stepv) * stepv;
    const maxN = Math.max(1, ...g.variants.map((x) => x.n));
    const L = 10, Rr = 10, base = top + 62;
    const xx = (pos: number) => L + (W - L - Rr) * pos / axisMax;
    out.push(`<text x="8" y="${top + 12}" font-size="11" font-weight="600" fill="${p.ink}">${esc(g.gene)}</text>`);
    // The variant count is capped at the aggregate layer (VARIANT_LIMIT), not
    // here, so a gene with more positions than the cap loses long-tail variants
    // silently unless this says so — matching the disclosure the web app already
    // gives for the same data (a chat/MCP client must not see a quieter figure).
    out.push(`<text x="${8 + esc(g.gene).length * 7 + 8}" y="${top + 12}" font-size="10" fill="${p.muted}">` +
      `${fmt(g.mutated)} mutated patients · ${g.variants.length} shown` +
      (g.withheld ? ` of ${fmt(g.variants.length + g.withheld)} distinct changes` : "") + `</text>`);
    out.push(`<line x1="${L}" y1="${base}" x2="${W - Rr}" y2="${base}" stroke="${p.line}" stroke-width="2"/>`);
    for (const x2 of positioned) {
      const cx = xx(x2.pos!), h = 10 + 40 * x2.n / maxN, r = Math.max(2.5, Math.min(6, 2 + 4 * x2.n / maxN));
      const col = x2.type && x2.type.startsWith("Missense") ? "#0072B2" : "#D55E00";
      out.push(`<line x1="${num(cx)}" y1="${base}" x2="${num(cx)}" y2="${num(base - h)}" stroke="${p.muted}" stroke-width="1" opacity="0.45"/>`);
      out.push(`<circle cx="${num(cx)}" cy="${num(base - h)}" r="${num(r)}" fill="${col}" opacity="0.9">` +
        `<title>${esc(x2.variant)} · ${fmt(x2.n)} patients (${x2.pct}%) · codon ${x2.pos}</title></circle>`);
    }
    for (let t = 0; t <= axisMax + 1e-9; t += stepv)
      out.push(`<text x="${num(xx(t))}" y="${base + 12}" font-size="9" fill="${p.muted}" text-anchor="${t === 0 ? "start" : "middle"}">${Math.round(t) || 1}</text>`);
    const top6 = g.variants.slice(0, 6).map((x2) => `${x2.variant} ${fmt(x2.n)} (${x2.pct}%)`).join("   ");
    out.push(`<text x="8" y="${base + 28}" font-size="10" fill="${p.ink}">${esc(top6)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
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
  const pairs = ((v.pairs || []) as CooccurRow[]).slice(0, 14);
  return barsSvg("Co-occurrence — log₂ odds ratio", pairs.map((r) => {
    const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : (r.log2Odds ?? 0);
    return { label: r.a + " / " + r.b, v: lor, signed: true,
      colour: lor < 0 ? "#D55E00" : "#0072B2",
      text: num(lor) + "   " + pFmt(r.pStratified ?? r.p).replace("p=", "") };
  }), v.note || "", o);
}

function compareSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.rows || []) as CompareRow[]).slice(0, 14);
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
  const rows = ((v.coexpression || []) as CoexprRow[]).slice(0, 14);
  return barsSvg("Co-expression — Pearson r", rows.map((r) => {
    const rr = r.rMeta ?? r.r ?? 0;
    return { label: r.a + " / " + r.b, v: rr, signed: true,
      colour: rr < 0 ? "#D55E00" : "#0072B2", text: num(rr) + "   n=" + fmt(r.n) };
  }), v.note || "", o);
}

function clinicalSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.clinical || []) as ClinicalRow[]).filter((r) => !r.skipped).slice(0, 14);
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
const RISK_FLOOR = 10;
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
  const cap = caption((v.caveat || "") + foot, W, T + plotsH + riskH + legendH + 6, p.muted, 96, 12);
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
  const cap = caption(v.caveat || "", W, bodyH + 30, p.muted, 96, 14);
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
  const p = palette(o.theme), W = o.width || 720;
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
        `height="${num(Math.max(ch, 0.8))}" fill="#0f86a1" fill-opacity="${num(shade(b.n))}"/>`);
    // the fitted line, over every case rather than over what is visible
    const st = d.stats;
    if (st && st.slope != null && st.intercept != null && x1 > x0) {
      const yAt = (xv: number) => st.intercept! + st.slope! * xv;
      const sx = (xv: number) => L + plotW * (xv - x0) / (x1 - x0);
      const sy = (yv: number) => T + PLOT - PLOT * (yv - y0) / Math.max(1e-9, y1 - y0);
      const ya = Math.max(y0, Math.min(y1, yAt(x0))), yb = Math.max(y0, Math.min(y1, yAt(x1)));
      out.push(`<line x1="${num(sx(x0))}" y1="${num(sy(ya))}" x2="${num(sx(x1))}" y2="${num(sy(yb))}" ` +
        `stroke="#D55E00" stroke-width="1.5" stroke-dasharray="4 3"/>`);
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
    const gs = d.groups.slice(0, 24);
    const lo = Math.min(...gs.map((g) => g.loWhisker)), hi = Math.max(...gs.map((g) => g.hiWhisker));
    const span = Math.max(1e-9, hi - lo);
    const bw = plotW / gs.length;
    const sy = (val: number) => T + PLOT - PLOT * (val - lo) / span;
    gs.forEach((g, i) => {
      const cx = L + bw * (i + 0.5), half = Math.min(24, bw * 0.32);
      out.push(`<line x1="${num(cx)}" y1="${num(sy(g.loWhisker))}" x2="${num(cx)}" y2="${num(sy(g.hiWhisker))}" stroke="${p.muted}"/>`);
      out.push(`<rect x="${num(cx - half)}" y="${num(sy(g.q3))}" width="${num(half * 2)}" height="${num(Math.max(1, sy(g.q1) - sy(g.q3)))}" ` +
        `fill="#0f86a1" fill-opacity="0.25" stroke="#0f86a1"/>`);
      out.push(`<line x1="${num(cx - half)}" y1="${num(sy(g.median))}" x2="${num(cx + half)}" y2="${num(sy(g.median))}" stroke="#0f86a1" stroke-width="2"/>`);
      const label = g.g.length > 14 ? g.g.slice(0, 13) + "…" : g.g;
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 26}" font-size="9" fill="${p.muted}" text-anchor="end" ` +
        `transform="rotate(-40 ${num(cx)} ${T + PLOT + 26})">${esc(label)}</text>`);
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 12}" font-size="8" fill="${p.muted}" text-anchor="middle">${fmt(g.n)}</text>`);
    });
    for (const t of [lo, (lo + hi) / 2, hi]) out.push(axisText(num(t), L - 6, sy(t) + 3, "end", 10));
    out.push(`<rect x="${L}" y="${T}" width="${num(plotW)}" height="${PLOT}" fill="none" stroke="${p.line}"/>`);
    const cap = caption("Box: quartiles with Tukey whiskers, computed over every case in the group. The count is above each name.",
      W, T + PLOT + 84, p.muted);
    return frame(W, T + PLOT + 84 + cap.height + 10, out.join("") + cap.svg, p.bg);
  }

  if (d.shape === "table" && d.cells && d.cells.length) {
    const xs = [...new Set(d.cells.map((c) => c.cx))].slice(0, 12);
    const ys = [...new Set(d.cells.map((c) => c.cy))].slice(0, 12);
    const at = new Map(d.cells.map((c) => [c.cx + "\u0000" + c.cy, c.n]));
    const maxN = Math.max(1, ...d.cells.map((c) => c.n));
    const LX = 130, cw = (W - LX - R) / xs.length, chh = Math.min(30, PLOT / Math.max(1, ys.length));
    ys.forEach((yv, r) => {
      out.push(`<text x="${LX - 6}" y="${num(T + chh * r + chh * 0.66)}" font-size="10" fill="${p.muted}" text-anchor="end">${esc(yv.length > 20 ? yv.slice(0, 19) + "…" : yv)}</text>`);
      xs.forEach((xv, c) => {
        const n = at.get(xv + "\u0000" + yv) || 0;
        out.push(`<rect x="${num(LX + cw * c)}" y="${num(T + chh * r)}" width="${num(cw - 1)}" height="${num(chh - 1)}" ` +
          `fill="#0f86a1" fill-opacity="${num(n ? 0.12 + 0.78 * Math.log1p(n) / Math.log1p(maxN) : 0.03)}"/>`);
        if (n) out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * r + chh * 0.66)}" font-size="9" ` +
          `fill="${p.ink}" text-anchor="middle">${fmt(n)}</text>`);
      });
    });
    xs.forEach((xv, c) => out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * ys.length + 12)}" font-size="9" ` +
      `fill="${p.muted}" text-anchor="end" transform="rotate(-40 ${num(LX + cw * (c + 0.5))} ${num(T + chh * ys.length + 12)})">${esc(xv.length > 16 ? xv.slice(0, 15) + "…" : xv)}</text>`));
    const h = T + chh * ys.length + 86;
    const cap = caption(d.x.label + " across, " + d.y.label + " down. " + fmt(d.n) + " cases counted in the database.", W, h, p.muted);
    return frame(W, h + cap.height + 10, out.join("") + cap.svg, p.bg);
  }
  return "";
}

export function viewToSvg(v: ViewResult, o: SvgOpts = {}): string | null {
  if (!v || v.error) return null;
  if (v.kind === "oncoprint") return v.svg || null;   // already rendered by the contract
  if (v.kind === "plot" && v.plot) return plotSvg(v, o) || null;
  if (v.kind === "course" && v.course && v.course.length) return courseSvg(v, o);
  if (v.kind === "sequence" && v.sequence && v.sequence.panels.some((z) => z.flows.length)) return sequenceSvg(v, o);
  if (v.kind === "survival" && v.curves && v.curves.length) return survivalSvg(v, o);
  if (v.kind === "hotspots" && v.hotspots && v.hotspots.length) return hotspotsSvg(v, o);
  if (v.kind === "cooccurrence" && v.pairs && v.pairs.length) return cooccurrenceSvg(v, o);
  if (v.kind === "compare" && v.rows && v.rows.length) return compareSvg(v, o);
  if (v.kind === "coexpression" && v.coexpression && v.coexpression.length) return coexpressionSvg(v, o);
  if (v.kind === "clinical" && v.clinical && v.clinical.some((r) => !r.skipped)) return clinicalSvg(v, o);
  return null;
}

/** A one-line title for a figure, for alt text and chat captions. */
export function viewTitle(v: ViewResult): string {
  const c = (v.cohorts || []).join(" vs ");
  const base = v.kind === "survival" ? (v.endpoint || "OS") + " survival" + (v.anchoredTo ? " from " + v.anchoredTo : "")
    : v.kind === "hotspots" ? "Recurrent protein changes"
    : v.kind === "cooccurrence" ? "Co-occurrence and mutual exclusivity"
    : v.kind === "coexpression" ? "Co-expression"
    : v.kind === "clinical" ? "Clinical comparison"
    : v.kind === "sequence" ? "Treatment sequence" +
        (v.sequence ? " by " + v.sequence.labelKey : "")
    : v.kind === "course" ? "Clinical course" +
        (v.course && v.course.length ? " — " + [...new Set(v.course.map((z) => z.eventType))].join(", ") : "")
    : v.kind === "compare" ? "Alteration frequencies"
    : v.kind === "oncoprint" ? "Oncoprint" : v.kind;
  return c ? base + " — " + c : base;
}
