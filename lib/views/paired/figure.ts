// Paired-samples figure: each gene's alteration in the two kinds of sample, within patients.
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, legend, label, textWidth, wrapWidth,
  fmtInt, fmtPct, pDigits, textOn, FS, SW, OTHER, SERIES, type SvgOpts
} from "../../svg-kit.ts";
import type { DrawnResultOf } from "../../types.ts";

const PAD = 8, GUT = 14, ROW = 20, BAR = 14, MIN_BAR_W = 200;

export function pairedSvg(v: DrawnResultOf<"paired">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.paired;
  let W = Math.max(480, o.width || 960);
  const aL = r.labels.a, bL = r.labels.b;
  const A = SERIES[0], B = SERIES[1], BOTH = OTHER;
  const genes = r.panels.flatMap((pn) => pn.genes);

  // the columns right of the bars, each as wide as its widest entry or its head
  const conc = (g: (typeof genes)[number]) => g.concordance == null ? "–" : fmtPct(100 * g.concordance);
  const qOf = (g: (typeof genes)[number]) => g.aOnly + g.bOnly ? pDigits(g.q) : "no discordance";
  const favours = (g: (typeof genes)[number]) => g.q < 0.05 && g.aOnly + g.bOnly > 0 ? "more " + (g.bOnly > g.aOnly ? bL : aL) + "-only" : "";
  const cols: { head: string; text: (g: (typeof genes)[number]) => string; w: number; end: boolean }[] = [
    { head: "concordant", text: conc, w: 0, end: true },
    { head: "profiled pairs", text: (g) => fmtInt(g.pairs), w: 0, end: true },
    { head: "McNemar q", text: qOf, w: 0, end: true },
    { head: "", text: favours, w: 0, end: false }
  ];
  for (const c of cols) c.w = Math.max(textWidth(c.head, FS.small), ...genes.map((g) => textWidth(c.text(g), FS.small)), 0);
  const statW = cols.reduce((s, c) => s + c.w + (c.w ? GUT : 0), 0);
  const geneW = Math.max(30, ...genes.map((g) => textWidth(g.gene, FS.body, 600)));
  const need = PAD + geneW + GUT + MIN_BAR_W + statW + PAD;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const BL = PAD + geneW + GUT, BR = W - PAD - statW;

  // one scale for every panel: patients altered on either side, the widest bar
  const widest = Math.max(1, ...genes.map((g) => g.aOnly + g.both + g.bOnly));
  const xs = linear(0, widest, BL, BR);
  const out: string[] = [];
  let y = 4;
  const lg = legend([{ label: aL + " only", color: A }, { label: "both", color: BOTH }, { label: bL + " only", color: B }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 6;

  r.panels.forEach((pn, pi) => {
    if (pi) y += 12;
    const head = pn.cohort, hw = Math.min(textWidth(head, FS.title, 600), W * 0.5);
    out.push(label(PAD, y + FS.title, head, { size: FS.title, weight: 600, fill: p.ink, maxW: W * 0.5 }));
    const detail = fmtInt(pn.patients) + " patients with both · " + fmtInt(pn.aSamples) + " " + aL + " and " + fmtInt(pn.bSamples) + " " + bL + " samples" +
      (pn.tested != null ? " · " + fmtInt(pn.tested) + " genes with a discordant patient, " + (pn.genes.length < pn.tested ? "the " + fmtInt(pn.genes.length) + " most one-sided" : "all") + " drawn" : "");
    const lines = wrapWidth(detail, W - PAD - hw - 8 - PAD, FS.small);
    lines.forEach((l, i) => out.push(label(PAD + hw + 8, y + FS.title + i * (FS.small + 3), l, { size: FS.small, fill: p.muted })));
    y += FS.title + (lines.length - 1) * (FS.small + 3) + 8;
    // column heads
    let cx = BR;
    for (const c of cols) {
      if (!c.w) continue;
      cx += GUT;
      if (c.head) out.push(label(c.end ? cx + c.w : cx, y + FS.small, c.head, { size: FS.small, fill: p.muted, anchor: c.end ? "end" : "start" }));
      cx += c.w;
    }
    y += FS.small + 4;
    const top = y;
    for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + pn.genes.length * ROW}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    pn.genes.forEach((g, gi) => {
      const ry = top + gi * ROW, cy = ry + ROW / 2;
      if (gi % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
      out.push(label(BL - GUT, cy + FS.body * 0.35, g.gene, { size: FS.body, weight: 600, fill: p.ink, anchor: "end" }));
      let x = BL;
      for (const [n, col, name] of [[g.aOnly, A, aL + " only"], [g.both, BOTH, "both"], [g.bOnly, B, bL + " only"]] as [number, string, string][]) {
        if (n <= 0) continue;
        const w = Math.max(1, xs(n) - BL);
        out.push(`<rect x="${r1(x)}" y="${r1(cy - BAR / 2)}" width="${r1(w)}" height="${BAR}" fill="${col}"><title>${esc(g.gene + " — " + fmtInt(n) + " patients altered " + name)}</title></rect>`);
        const t = fmtInt(n);
        if (textWidth(t, FS.small) + 6 <= w) out.push(label(x + w / 2, cy + FS.small * 0.35, t, { size: FS.small, fill: textOn(col), anchor: "middle" }));
        x += w;
      }
      if (!g.pairs) out.push(label(BL + 2, cy + FS.small * 0.35, "never profiled on both sides", { size: FS.small, fill: p.muted }));
      const sig = g.q < 0.05 && g.aOnly + g.bOnly > 0;
      let sx = BR;
      for (const c of cols) {
        if (!c.w) continue;
        sx += GUT;
        out.push(label(c.end ? sx + c.w : sx, cy + FS.small * 0.35, c.text(g), { size: FS.small, fill: sig ? p.ink : p.muted, anchor: c.end ? "end" : "start", weight: sig && c.head === "McNemar q" ? 600 : 400 }));
        sx += c.w;
      }
    });
    y = top + pn.genes.length * ROW;
  });
  const axTitle = "patients altered on either side";
  out.push(axisBottom(xs, y, p, { title: axTitle, minX: BL - GUT, maxX: BR + GUT, fmt: (t) => fmtInt(t) }));
  y += bottomAxisHeight(axTitle) + 8;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "Paired samples — " + aL + " vs " + bL);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
