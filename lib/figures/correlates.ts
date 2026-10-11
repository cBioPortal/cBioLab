// Correlates figure: one gene's expression against every gene's.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";

export function correlatesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.correlates!;
  const W = o.width || 960;
  const out: string[] = [];
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} genes against ${esc(r.gene)} · ${fmt(r.significant)} at q &lt; 0.05 · Spearman ρ${r.rhoFrom === "meta" ? " (Fisher-z across studies)" : ""}</text>`);
  // every tested gene's ρ, as a histogram
  const HL = 40, HT = 34, HW = 300, HH = 200;
  const maxN = Math.max(1, ...r.histogram.map((h) => h[1]));
  const X = (rho: number) => HL + HW * (rho + 1) / 2;
  for (const f of [-1, -0.5, 0, 0.5, 1]) out.push(`<line x1="${num(X(f))}" y1="${HT}" x2="${num(X(f))}" y2="${HT + HH}" stroke="${p.line}" stroke-width="${f === 0 ? 1 : 0.6}"/>` +
    `<text x="${num(X(f))}" y="${HT + HH + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(f)}</text>`);
  for (const [lo, n] of r.histogram) {
    const h = HH * n / maxN;
    out.push(`<rect x="${num(X(lo))}" y="${num(HT + HH - h)}" width="${num(HW / 40 - 0.6)}" height="${num(h)}" fill="${lo < 0 ? SERIES[1] : SERIES[0]}" opacity="0.75"><title>ρ ${lo} to ${num(lo + 0.05)}: ${fmt(n)} genes</title></rect>`);
  }
  out.push(`<text x="${HL + HW / 2}" y="${HT + HH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">Spearman ρ with ${esc(r.gene)}</text>` +
    `<text x="${HL - 6}" y="${HT + 8}" font-size="9" fill="${p.muted}" text-anchor="end">${fmt(maxN)}</text>` +
    `<text x="${HL - 6}" y="${HT + HH}" font-size="9" fill="${p.muted}" text-anchor="end">0</text>`);
  // the most positive and most negative genes, side by side
  const TX = HL + HW + 30, COL = (W - TX - 10) / 2, ROWS = Math.min(25, Math.max(r.positive.length, r.negative.length));
  const list = (genes: typeof r.positive, x: number, title: string, color: string) => {
    out.push(`<text x="${num(x)}" y="30" font-size="10" fill="${color}">${esc(title)}</text>` +
      `<text x="${num(x + COL - 12)}" y="30" font-size="9" fill="${p.muted}" text-anchor="end">ρ · r · q</text>`);
    genes.slice(0, ROWS).forEach((g, i) => {
      const y = 40 + i * 15, w = 60 * Math.abs(g.rho ?? 0);
      out.push(`<text x="${num(x)}" y="${y + 9}" font-size="10" font-weight="600" fill="${p.ink}">${esc(g.gene)}</text>` +
        `<rect x="${num(x + 70)}" y="${y + 1}" width="${num(Math.max(0.5, w))}" height="9" fill="${color}" opacity="0.85"/>` +
        `<text x="${num(x + COL - 12)}" y="${y + 9}" font-size="9" fill="${p.muted}" text-anchor="end">${esc(String(g.rho))} · ${esc(String(g.r))} · ${esc(g.q === 0 ? "<1e-300" : g.q < 1e-4 ? g.q.toExponential(0) : g.q.toFixed(3))}</text>`);
    });
  };
  list(r.positive, TX, "rise with " + r.gene, SERIES[0]);
  list(r.negative, TX + COL, "fall as " + r.gene + " rises", SERIES[1]);
  let bottom = Math.max(HT + HH + 34, 40 + ROWS * 15 + 6);
  const hidden = Math.max(0, r.positive.length - ROWS) + Math.max(0, r.negative.length - ROWS);
  out.push(`<text x="${TX}" y="${bottom + 4}" font-size="9" fill="${p.muted}">${hidden ? "+" + fmt(hidden) + " more listed in the result and the MCP text; " : ""}every one of the ${fmt(r.tested)} genes is in the histogram</text>`);
  bottom += 14;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}
