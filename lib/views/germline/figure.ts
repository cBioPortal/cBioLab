// Germline figure: per cohort, one row per gene — its carriers among the patients sequenced, and two
// bars, the carriers' somatic second-hit rate against the non-carriers' somatic rate — then OS by
// carrier status for one gene.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, legend, textWidth, linear, axisBottom, bottomAxisHeight, seriesStyle, fmtInt, fmtPct, fmtNum, fmtP, pDigits, num, FS, SW, type SvgOpts } from "../../svg-kit.ts";
import { kmPanel } from "../../figures/km.ts";
import type { GermlineGene } from "./types.ts";

const PAD = 8, ROW = 30, BAR = 9;
const CAR = seriesStyle(0).color, NON = seriesStyle(1).color;
const pct = (k: number, n: number) => n ? fmtPct(100 * k / n) : "–";

export function germlineSvg(v: DrawnResultOf<"germline">, o: SvgOpts): string {
  const r = v.germline, p = palette(o.theme), want = o.width || 936, W = Math.max(440, want);
  const out: string[] = [];
  let y = 0;
  const lg = legend([{ label: "Carriers: somatic second hit (mutation or deep deletion)", color: CAR, kind: "rect" }, { label: "Non-carriers: somatic mutation or deep deletion", color: NON, kind: "rect" }], PAD, y + 4, W - 2 * PAD, p);
  out.push(lg.svg);
  y += lg.height + 10;
  const geneW = Math.max(...r.panels.flatMap((pn) => pn.genes.map((g) => textWidth(g.gene, FS.body, 600)))) + 8;
  const carrierText = (g: GermlineGene) => fmtInt(g.carriers) + " of " + fmtInt(g.sequenced) + " (" + pct(g.carriers, g.sequenced) + ")";
  const carW = Math.max(textWidth("Carriers / sequenced", FS.small, 600), ...r.panels.flatMap((pn) => pn.genes.map((g) => textWidth(carrierText(g), FS.small)))) + 20;
  const qW = textWidth("q 0.0001", FS.small) + 10;
  const x0 = PAD + geneW + carW, x1 = W - PAD - qW - 70;
  for (const pn of r.panels) {
    out.push(label(PAD, y + FS.title, pn.cohort + " · " + fmtInt(pn.patients) + " patients", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 2 * PAD }));
    y += FS.title + 10;
    const shown = pn.genes.filter((g) => g.sequenced > 0);
    const max = Math.max(0.1, ...shown.flatMap((g) => [g.carriers ? g.carrierEither / g.carriers : 0, g.noncarriers ? g.noncarrierEither / g.noncarriers : 0]));
    const xs = linear(0, Math.min(1, max * 1.1), x0, x1);
    out.push(label(PAD + geneW, y + FS.small, "Carriers / sequenced", { size: FS.small, fill: p.muted, weight: 600 }));
    out.push(label(x0, y + FS.small, "Second hit, % of carriers / non-carriers", { size: FS.small, fill: p.muted, weight: 600, maxW: x1 - x0 }));
    y += FS.small + 6;
    for (const g of shown) {
      const cy = y + ROW / 2;
      out.push(label(PAD, cy + FS.body * 0.35, g.gene, { size: FS.body, fill: p.ink, weight: 600 }));
      out.push(label(PAD + geneW, cy + FS.small * 0.35, carrierText(g), { size: FS.small, fill: p.ink }));
      const sides: [number, number, string, string][] = [[g.carrierEither, g.carriers, CAR, "carriers"], [g.noncarrierEither, g.noncarriers, NON, "non-carriers"]];
      sides.forEach(([k, n, color, who], i) => {
        const by = cy - BAR - 1 + i * (BAR + 2);
        if (!n) return;
        const w = xs(k / n) - x0;
        out.push(`<rect x="${num(x0)}" y="${num(by)}" width="${num(Math.max(0.5, w))}" height="${BAR}" fill="${color}"><title>${g.gene} ${who}: ${fmtInt(k)} of ${fmtInt(n)} (${pct(k, n)})</title></rect>`);
        out.push(label(x0 + w + 4, by + BAR - 1, pct(k, n) + (i === 0 ? " (" + fmtInt(k) + ")" : ""), { size: FS.small, fill: p.ink }));
      });
      if (g.q != null) out.push(label(W - PAD, cy + FS.small * 0.35, "q " + pDigits(g.q), { size: FS.small, fill: p.ink, anchor: "end", weight: g.q < 0.05 ? 600 : 400 }));
      y += ROW;
    }
    out.push(`<line x1="${num(x0)}" y1="${y}" x2="${num(x0)}" y2="${y - shown.length * ROW}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    out.push(axisBottom(xs, y + 2, p, { title: "Share with a somatic hit in the gene", fmt: (t) => Math.round(t * 100) + "%" }));
    y += bottomAxisHeight("x") + 10;
    const unseq = pn.genes.filter((g) => !g.sequenced).map((g) => g.gene);
    if (unseq.length) { out.push(label(PAD, y + FS.small, "Not drawn (no patient sequenced for it): " + unseq.join(", "), { size: FS.small, fill: p.muted, maxW: W - 2 * PAD })); y += FS.small + 8; }
  }
  for (const s of r.survival || []) {
    y += 6;
    const km = kmPanel(s.curves.filter((c) => c.n > 0).map((c) => ({ name: c.group, points: c.points, atRisk: c.atRisk,
      detail: "n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " deaths · median " + (c.median == null ? "not reached" : fmtNum(Math.round(c.median * 10) / 10) + " mo") })),
    { y0: y, W, p, xTitle: "Months (OS_MONTHS)", yTitle: "Overall survival", title: "Overall survival by " + s.gene + " germline status — " + s.cohort });
    out.push(km.svg);
    y += km.height + 4;
    const line = s.logrank ? "Log-rank χ² = " + fmtNum(s.logrank.chi2) + " (" + s.logrank.df + " df) · " + fmtP(s.logrank.p) : s.noTest || "";
    if (line) { out.push(label(PAD, y + FS.body, line, { size: FS.body, fill: p.ink, maxW: W - 2 * PAD })); y += Math.round(FS.body * 1.8); }
  }
  const cap = caption("LOH: " + r.loh + ". " + (v.caveat || ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, "Germline carriers and second hits — " + r.genes.length + " genes");
}
