// ctDNA-vs-tissue figure: per gene, patients altered in both, tissue only and plasma only (with
// plasma's positive percent agreement), then overall survival by ctDNA detected or not.
import {
  esc, palette, frame, caption, linear, axisBottom, axisLeft, leftAxisWidth, bottomAxisHeight, legend, label, textWidth, wrapWidth,
  fmtInt, fmtShare, fmtP, fmtNum, fmtMonths, textOn, seriesStyle, timeScale, timeTitle, stepPath, paragraph, FS, SW, OTHER, SERIES, type SvgOpts
} from "../svg-kit.ts";
import { plotHeight } from "./common.ts";
import type { DrawnResultOf, CtdnaGene, CtdnaPanel } from "../types.ts";

const PAD = 8, GUT = 14, ROW = 20, BAR = 14, MIN_BAR_W = 200;

export function ctdnaSvg(v: DrawnResultOf<"ctdna">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.ctdna;
  let W = Math.max(480, o.width || 960);
  const TISSUE = SERIES[0], PLASMA = SERIES[1], BOTH = OTHER;
  const genes = r.panels.flatMap((pn) => pn.genes);
  const ppa = (g: CtdnaGene) => g.ppa == null ? "–" : fmtShare(g.ppa, 0) + " [" + fmtShare(g.ppaLow!, 0) + "–" + fmtShare(g.ppaHigh!, 0) + "]";
  const cols: { head: string; text: (g: CtdnaGene) => string; w: number }[] = [
    { head: "PPA [95% CI]", text: ppa, w: 0 },
    { head: "concordant", text: (g) => g.concordance == null ? "–" : fmtShare(g.concordance, 0), w: 0 },
    { head: "pairs", text: (g) => fmtInt(g.pairs), w: 0 }
  ];
  if (r.chFilter) {
    const before = new Map(r.panels.flatMap((pn) => (pn.ch ? pn.ch.before.genes : []).map((g) => [pn.cohort + "\u0000" + g.gene, g] as const)));
    const at = (g: CtdnaGene) => before.get(r.panels.find((pn) => pn.genes.includes(g))!.cohort + "\u0000" + g.gene);
    cols.unshift({ head: "plasma-only unfiltered", text: (g) => { const b = at(g); return b ? fmtInt(b.plasmaOnly) : "–"; }, w: 0 });
  }
  for (const c of cols) c.w = Math.max(textWidth(c.head, FS.small), ...genes.map((g) => textWidth(c.text(g), FS.small)), 0);
  const statW = cols.reduce((s, c) => s + c.w + GUT, 0);
  const geneW = Math.max(30, ...genes.map((g) => textWidth(g.gene, FS.body, 600)));
  const need = PAD + geneW + GUT + MIN_BAR_W + statW + PAD;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const BL = PAD + geneW + GUT, BR = W - PAD - statW;
  const widest = Math.max(1, ...genes.map((g) => g.both + g.tissueOnly + g.plasmaOnly));
  const xs = linear(0, widest, BL, BR);
  const out: string[] = [];
  let y = 4;
  const lg = legend([{ label: "tissue only", color: TISSUE }, { label: "both", color: BOTH }, { label: "plasma only", color: PLASMA }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 6;

  r.panels.forEach((pn, pi) => {
    if (pi) y += 14;
    const head = pn.cohort, hw = Math.min(textWidth(head, FS.title, 600), W * 0.5);
    out.push(label(PAD, y + FS.title, head, { size: FS.title, weight: 600, fill: p.ink, maxW: W * 0.5 }));
    const detail = fmtInt(pn.patients) + " patients with plasma and tissue · ctDNA detected in " + fmtInt(pn.detected) + " of " + fmtInt(pn.plasmaPatients) +
      " with plasma" + (pn.plasmaPatients ? " (" + fmtShare(pn.detected / pn.plasmaPatients, 0) + ")" : "");
    const lines = wrapWidth(detail, W - PAD - hw - 12 - PAD, FS.small);
    lines.forEach((l, i) => out.push(label(PAD + hw + 12, y + FS.title + i * (FS.small + 3), l, { size: FS.small, fill: p.muted })));
    y += FS.title + (lines.length - 1) * (FS.small + 3) + 8;
    if (pn.ch) {
      const c = pn.ch, b = c.before;
      const text = "Clonal-haematopoiesis filter removed " + fmtInt(c.removed) + " of " + fmtInt(c.calls) + " plasma mutation calls in " + fmtInt(c.patients) + " patients (" +
        fmtInt(c.byGene) + " by gene, " + fmtInt(c.byNormal) + " seen in the matched normal)" + (c.genes.length ? ": " + c.genes.slice(0, 8).map((g) => g.gene + " " + fmtInt(g.calls)).join(", ") + (c.genes.length > 8 ? ", " + fmtInt(c.genes.length - 8) + " more genes" : "") : "") +
        " · unfiltered, ctDNA detected in " + fmtInt(b.detected) + (pn.plasmaPatients ? " (" + fmtShare(b.detected / pn.plasmaPatients, 0) + ")" : "") +
        (b.survival && b.survival.p != null ? ", OS log-rank " + fmtP(b.survival.p) : "");
      const para = paragraph(text, PAD, y, W - 2 * PAD, p.ink, { size: FS.small });
      out.push(para.svg);
      y += para.height + 6;
    }
    let cx = BR;
    for (const c of cols) { cx += GUT; out.push(label(cx + c.w, y + FS.small, c.head, { size: FS.small, fill: p.muted, anchor: "end" })); cx += c.w; }
    y += FS.small + 4;
    const top = y;
    for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + pn.genes.length * ROW}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    pn.genes.forEach((g, gi) => {
      const ry = top + gi * ROW, cy = ry + ROW / 2;
      if (gi % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
      out.push(label(BL - GUT, cy + FS.body * 0.35, g.gene, { size: FS.body, weight: 600, fill: p.ink, anchor: "end" }));
      let x = BL;
      for (const [n, col, name] of [[g.tissueOnly, TISSUE, "in tissue only"], [g.both, BOTH, "in both"], [g.plasmaOnly, PLASMA, "in plasma only"]] as [number, string, string][]) {
        if (n <= 0) continue;
        const w = Math.max(1, xs(n) - BL);
        out.push(`<rect x="${r1(x)}" y="${r1(cy - BAR / 2)}" width="${r1(w)}" height="${BAR}" fill="${col}"><title>${esc(g.gene + " — " + fmtInt(n) + (n === 1 ? " patient " : " patients ") + name)}</title></rect>`);
        const t = fmtInt(n);
        if (textWidth(t, FS.small) + 6 <= w) out.push(label(x + w / 2, cy + FS.small * 0.35, t, { size: FS.small, fill: textOn(col), anchor: "middle" }));
        x += w;
      }
      if (!g.pairs) out.push(label(BL + 2, cy + FS.small * 0.35, "never covered by both panels", { size: FS.small, fill: p.muted }));
      let sx = BR;
      for (const c of cols) { sx += GUT; out.push(label(sx + c.w, cy + FS.small * 0.35, c.text(g), { size: FS.small, fill: p.muted, anchor: "end" })); sx += c.w; }
    });
    y = top + pn.genes.length * ROW;
    const axTitle = "patients altered in plasma or tissue";
    out.push(axisBottom(xs, y, p, { title: axTitle, minX: BL - GUT, maxX: BR + GUT, fmt: (t) => fmtInt(t) }));
    y += bottomAxisHeight(axTitle) + 8;
    const km = kmPanel(pn, W, y, p);
    out.push(km.svg);
    y += km.height;
  });
  const cap = caption(v.caveat || "", W, y + 4, p.muted);
  return frame(W, y + 4 + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "ctDNA vs tissue");
}

/** overall survival by ctDNA detected or not, or a line saying why it is not drawn */
function kmPanel(pn: CtdnaPanel, W: number, y0: number, p: ReturnType<typeof palette>): { svg: string; height: number } {
  if (!pn.survival) {
    const t = "Overall survival by ctDNA not drawn: " + (pn.survivalWhy || "no survival data");
    return { svg: label(PAD, y0 + FS.small + 2, t, { size: FS.small, fill: p.muted, maxW: W - 2 * PAD }), height: FS.small + 10 };
  }
  const out: string[] = [];
  const s = pn.survival;
  let y = y0 + 6;
  const items = s.curves.map((c, i) => ({ label: c.label + " — " + fmtInt(c.n) + " patients, " + fmtInt(c.events) + " deaths, median " + (c.median == null ? "not reached" : fmtMonths(c.median)),
    color: seriesStyle(i).color, dash: seriesStyle(i).dash, kind: "line" as const }));
  out.push(label(PAD, y + FS.body, "Overall survival by ctDNA detected", { size: FS.body, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
  y += FS.body + 6;
  const lg = legend(items, PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 4;
  const PLOT = plotHeight(W), T = y + 4, R = 16;
  const tMax = Math.max(1, ...s.curves.flatMap((c) => c.points.map((q) => q.t)));
  const ys = linear(0, 1, T + PLOT, T, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const yFmt = (t: number) => fmtShare(t, 0), yTitle = "Survival probability";
  const L = PAD + leftAxisWidth(ys, yTitle, yFmt);
  const xs = timeScale(0, tMax, L, W - R);
  const xTitle = timeTitle("Months", null);
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R, fmt: yFmt }));
  out.push(axisBottom(xs, T + PLOT, p, { title: xTitle, minX: 0, maxX: W }));
  s.curves.forEach((c, i) => {
    const st = seriesStyle(i);
    out.push(`<path d="${stepPath(c.points, xs, ys, { t: 0, s: 1 }, tMax)}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
  });
  y = T + PLOT + bottomAxisHeight(xTitle) + 4;
  if (s.logrank) {
    out.push(label(PAD, y + FS.small, "log-rank χ² = " + fmtNum(s.logrank.chi2) + " · " + fmtP(s.logrank.p) + (s.logrank.strata > 1 ? " · stratified by study" : "") +
      (s.missing ? " · " + fmtInt(s.missing) + " plasma patients without OS left out" : ""), { size: FS.small, fill: p.muted, maxW: W - 2 * PAD }));
    y += FS.small + 6;
  }
  return { svg: out.join(""), height: y - y0 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
