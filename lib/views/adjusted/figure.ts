// Adjusted enrichment figure: the volcano of each gene's adjusted log2 odds ratio against −log₁₀ q,
// then the top genes' table, raw beside adjusted.
import type { DrawnResultOf } from "../../types.ts";
import { volcano, volcanoPlotH, type VolcanoPoint } from "../../figures/volcano.ts";
import { palette, frame, caption, label, textWidth, wrapWidth, seriesStyle, fmtInt, fmtPct, fmtRatio, pDigits, FS, SW, type SvgOpts } from "../../svg-kit.ts";

const TABLE_ROWS = 15;
/** the smallest 1, 2 or 5 × 10^k at or above x: an axis end a reader can read off */
const niceCeil = (x: number) => { const k = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((m) => m * k).find((v) => v >= x - 1e-12)!; };

export function adjustedSvg(v: DrawnResultOf<"adjusted">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.adjusted, want = o.width || 936, W = Math.max(520, want);
  const lq = (q: number) => -Math.log10(Math.max(1e-300, q));
  const x = (g: { or: number }) => Math.log2(g.or);
  const xMax = niceCeil(Math.max(1, ...r.rows.map((g) => Math.abs(x(g)))));
  const yMax = niceCeil(Math.max(2, ...r.rows.map((g) => lq(g.q))));
  const color = (g: { q: number; or: number }) => g.q >= 0.05 ? p.muted : seriesStyle(g.or > 1 ? 0 : 1).color;
  const pct = (a: number, n: number) => n ? fmtPct(100 * a / n) : "–";
  const pts: VolcanoPoint[] = r.rows.map((g) => ({ key: g.gene, x: x(g), p: g.q, color: color(g),
    tip: g.gene + ": " + r.groups.map((c, i) => c + " " + pct(g.altered[i], g.profiled[i])).join(", ") + " · adjusted OR " + fmtRatio(g.or) + ", q " + pDigits(g.q) }));
  const out: string[] = [];
  const head = fmtInt(r.rows.length) + " genes fit · " + fmtInt(r.significant) + " at q < 0.05 after adjusting for " + (r.covariates.length ? r.covariates.join(", ") : "nothing") +
    (r.failed.length ? " · " + fmtInt(r.failed.length) + " not fit (listed below)" : "");
  const hl = wrapWidth(head, W - 16, FS.body);
  hl.forEach((l, i) => out.push(label(8, 14 + i * Math.round(FS.body * 1.4), l, { size: FS.body, fill: p.muted })));
  let y = 14 + hl.length * Math.round(FS.body * 1.4) + 6;
  const vw = Math.min(W, 720);
  const vol = volcano(p, { x0: 0, y0: y, width: vw, plotH: volcanoPlotH(vw), grid: { xMax, yMax, nx: 1, ny: 1, cells: [] }, pts, labels: r.labels,
    xTitle: "Adjusted log2 odds ratio", sides: [r.groups[0], r.groups[1]], r: 3, pName: "q" });
  out.push(vol.svg);
  y += vol.height + 20;

  // the table: Gene · altered % per cohort · raw OR (Fisher p) · adjusted OR [CI] · q
  const shown = r.rows.slice(0, TABLE_ROWS);
  type Col = { head: string; anchor: "start" | "end"; text: (g: (typeof shown)[number]) => string; w: number; bold?: (g: (typeof shown)[number]) => boolean };
  const col = (head: string, anchor: "start" | "end", text: Col["text"], bold?: Col["bold"]): Col =>
    ({ head, anchor, text, bold, w: Math.ceil(Math.max(Math.min(150, textWidth(head, FS.body, 600)), ...shown.map((g) => textWidth(text(g), FS.body, 600)))) });
  const cols: Col[] = [
    col("Gene", "start", (g) => g.gene, () => true),
    ...r.groups.map((c, i) => col(c, "end", (g) => fmtInt(g.altered[i]) + "/" + fmtInt(g.profiled[i]) + " (" + pct(g.altered[i], g.profiled[i]) + ")")),
    col("Raw OR (Fisher p)", "end", (g) => (g.rawOr == null ? "–" : fmtRatio(g.rawOr)) + " (" + pDigits(g.fisherP) + ")"),
    col("Adjusted OR [95% CI]", "end", (g) => fmtRatio(g.or) + " [" + fmtRatio(g.ciLow) + "–" + fmtRatio(g.ciHigh) + "]"),
    col("q", "end", (g) => pDigits(g.q), (g) => g.q < 0.05),
  ];
  const CG = 14;
  const tableW = 8 + cols.reduce((a, c) => a + c.w + CG, 0);
  const Wt = Math.max(W, Math.ceil(tableW));
  let cx = 8;
  const at: number[] = [];
  for (const c of cols) {
    const xx = c.anchor === "end" ? cx + c.w : cx;
    at.push(xx);
    out.push(label(xx, y, c.head, { size: FS.body, fill: p.ink, weight: 600, anchor: c.anchor, maxW: c.w }));
    cx += c.w + CG;
  }
  out.push(`<line x1="8" y1="${y + 5}" x2="${Math.round(cx - CG)}" y2="${y + 5}" stroke="${p.line}" stroke-width="${SW.series}"/>`);
  const ROW = 18;
  shown.forEach((g, i) => {
    const yy = y + 6 + (i + 1) * ROW;
    cols.forEach((c, j) => out.push(label(at[j], yy, c.text(g), { size: FS.body, fill: p.ink, anchor: c.anchor, weight: c.bold && c.bold(g) ? 600 : 400 })));
  });
  y += 6 + shown.length * ROW + 6;
  if (r.rows.length > shown.length) {
    y += FS.small + 4;
    out.push(label(8, y, "+" + fmtInt(r.rows.length - shown.length) + " more genes fit (the full table is in the result and the MCP text)", { size: FS.small, fill: p.muted, maxW: Wt - 16 }));
  }
  y += 6;
  const cap = caption(v.caveat || "", Wt, y, p.muted);
  return frame(Wt, y + cap.height + 8, out.join("") + cap.svg, p.bg, Wt > want,
    "Adjusted enrichment — " + r.groups.join(" vs ") + (r.covariates.length ? ", adjusted for " + r.covariates.join(", ") : ""));
}
