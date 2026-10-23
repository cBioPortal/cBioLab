// Driver-negative figure: the cohort split into driver-positive, driver-negative and not fully
// profiled as one bar, then the volcano of every other gene between the two groups and its top genes.
import type { DrawnResultOf } from "../types.ts";
import { volcano, volcanoPlotH, type VolcanoPoint } from "./volcano.ts";
import { palette, frame, caption, label, textWidth, wrapWidth, seriesStyle, textOn, fmtInt, fmtPct, pDigits, FS, SW, OTHER, type SvgOpts } from "../svg-kit.ts";

const PAD = 8, TABLE_ROWS = 12;
const NEG = seriesStyle(0).color, POS = seriesStyle(1).color;
const niceCeil = (x: number) => { const k = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((m) => m * k).find((v) => v >= x - 1e-12)!; };

export function drivernegativeSvg(v: DrawnResultOf<"drivernegative">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.drivernegative, want = o.width || 936, W = Math.max(520, want);
  const out: string[] = [];
  const pct = (k: number, d: number) => d ? fmtPct(100 * k / d) : "–";
  // the split, one bar over the sequenced patients
  const parts = [["Driver-negative", r.negative, NEG], ["Driver-positive", r.positive, POS], ["Not fully profiled", r.unprofiled, OTHER]] as const;
  const head = fmtInt(r.sequenced) + " patients sequenced · drivers: " + r.drivers.join(", ");
  const hl = wrapWidth(head, W - 2 * PAD, FS.body);
  hl.forEach((l, i) => out.push(label(PAD, 14 + i * Math.round(FS.body * 1.4), l, { size: FS.body, fill: p.muted })));
  let y = 14 + hl.length * Math.round(FS.body * 1.4) + 6;
  let x = PAD;
  const BW = W - 2 * PAD;
  for (const [name, k, color] of parts) {
    if (!k) continue;
    const w = BW * k / r.sequenced, text = name + " " + fmtInt(k) + " (" + pct(k, r.sequenced) + ")";
    out.push(`<rect x="${r1(x)}" y="${y}" width="${r1(Math.max(0.5, w))}" height="20" fill="${color}"/>`);
    if (w > textWidth(text, FS.small) + 8) out.push(label(x + 4, y + 14, text, { size: FS.small, fill: textOn(color) }));
    x += w;
  }
  y += 26;
  const legendText = parts.map(([name, k]) => name + " " + fmtInt(k) + " (" + pct(k, r.sequenced) + ")").join(" · ");
  wrapWidth(legendText, W - 2 * PAD, FS.small).forEach((l) => { y += Math.round(FS.small * 1.35); out.push(label(PAD, y, l, { size: FS.small, fill: p.ink })); });
  y += 14;

  // the volcano: driver-negative to the right
  const xOf = (g: { log2Ratio: number | null; altered: [number, number] }, xm: number) => g.log2Ratio == null ? (g.altered[0] ? xm : -xm) : g.log2Ratio;
  const xMax = niceCeil(Math.max(1, ...r.rows.map((g) => g.log2Ratio == null ? 0 : Math.abs(g.log2Ratio))));
  const yMax = niceCeil(Math.max(2, ...r.rows.map((g) => -Math.log10(Math.max(1e-300, g.p)))));
  const pts: VolcanoPoint[] = r.rows.map((g) => ({ key: g.gene, x: xOf(g, xMax), p: g.p,
    color: g.q >= 0.05 ? p.muted : (g.log2Ratio ?? (g.altered[0] ? 1 : -1)) > 0 ? NEG : POS,
    tip: g.gene + ": driver-negative " + pct(g.altered[0], g.profiled[0]) + ", driver-positive " + pct(g.altered[1], g.profiled[1]) + " · q " + pDigits(g.q) }));
  const vw = Math.min(W, 720);
  const vol = volcano(p, { x0: 0, y0: y, width: vw, plotH: volcanoPlotH(vw), grid: { xMax, yMax, nx: 1, ny: 1, cells: [] }, pts, labels: r.labels,
    xTitle: "Log2 ratio, driver-negative over driver-positive", sides: ["Driver-negative", "Driver-positive"], r: 3 });
  out.push(vol.svg);
  y += vol.height + 18;

  // the genes most enriched in the driver-negative group
  const top = r.rows.filter((g) => (g.log2Ratio ?? (g.altered[0] ? 1 : -1)) > 0).slice(0, TABLE_ROWS);
  if (top.length) {
    out.push(label(PAD, y, "Most enriched in driver-negative patients", { size: FS.body, fill: p.ink, weight: 600 }));
    y += 8;
    const cell = (a: number, n: number) => fmtInt(a) + "/" + fmtInt(n) + " (" + pct(a, n) + ")";
    const cols = [
      { head: "Gene", text: (g: (typeof top)[number]) => g.gene + (g.cytoband ? " " + g.cytoband : ""), end: false },
      { head: "Driver-negative", text: (g: (typeof top)[number]) => cell(g.altered[0], g.profiled[0]), end: true },
      { head: "Driver-positive", text: (g: (typeof top)[number]) => cell(g.altered[1], g.profiled[1]), end: true },
      { head: "p", text: (g: (typeof top)[number]) => pDigits(g.p), end: true },
      { head: "q", text: (g: (typeof top)[number]) => pDigits(g.q), end: true },
    ].map((c) => ({ ...c, w: Math.ceil(Math.max(textWidth(c.head, FS.body, 600), ...top.map((g) => textWidth(c.text(g), FS.body)))) }));
    let cx = PAD;
    const at = cols.map((c) => { const a = c.end ? cx + c.w : cx; cx += c.w + 14; return a; });
    y += FS.body + 4;
    cols.forEach((c, j) => out.push(label(at[j], y, c.head, { size: FS.body, fill: p.ink, weight: 600, anchor: c.end ? "end" : "start" })));
    out.push(`<line x1="${PAD}" y1="${y + 5}" x2="${r1(cx - 14)}" y2="${y + 5}" stroke="${p.line}" stroke-width="${SW.series}"/>`);
    top.forEach((g) => { y += 18; cols.forEach((c, j) => out.push(label(at[j], y + 4, c.text(g), { size: FS.body, fill: p.ink, anchor: c.end ? "end" : "start", weight: c.head === "q" && g.q < 0.05 ? 600 : 400 }))); });
    y += 16;
  }
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, "Driver-negative analysis — " + r.drivers.length + " drivers");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
