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
import type { ViewResult, KmCurve, CooccurRow, HotspotGene, CompareRow, ClinicalRow, CoexprRow } from "./types.ts";

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
function caption(text: string, w: number, y0: number, muted: string, perLine = 96): { svg: string; height: number } {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > perLine) { lines.push(line.trim()); line = word; }
    else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  const capped = lines.slice(0, 6);
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
export function viewToSvg(v: ViewResult, o: SvgOpts = {}): string | null {
  if (!v || v.error) return null;
  if (v.kind === "oncoprint") return v.svg || null;   // already rendered by the contract
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
    : v.kind === "compare" ? "Alteration frequencies"
    : v.kind === "oncoprint" ? "Oncoprint" : v.kind;
  return c ? base + " — " + c : base;
}
