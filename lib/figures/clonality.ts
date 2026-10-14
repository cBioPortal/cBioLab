// Clonality figure: clonal and subclonal calls, LOH, WGD, purity and ploidy per cohort.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { qFmt, type Pal } from "./common.ts";

/** A small histogram as bars, scaled to its own tallest bin. */
function sparkHist(h: number[], x: number, y: number, w: number, hgt: number, colour: string, p: Pal): string {
  const max = Math.max(1, ...h), bw = w / h.length;
  let d = "";
  h.forEach((c, i) => { if (c) { const bh = hgt * c / max; d += `M${num(x + i * bw)} ${num(y + hgt)}v${num(-bh)}h${num(bw - 0.6)}v${num(bh)}z`; } });
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="${p.line}" opacity="0.35"/><path d="${d}" fill="${colour}"/>`;
}

export function clonalitySvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.clonality!;
  const W = o.width || 960, LBL = 80, BAR_X = LBL + 10, BAR_W = 300, TXT_X = BAR_X + BAR_W + 8, SIDE_X = 640;
  const k = r.panels.length, subH = 14, rowH = k * subH + 10;
  const out: string[] = [];
  out.push(`<text x="${BAR_X}" y="14" font-size="10" fill="${p.muted}">${r.measure === "driver" ? "driver " : ""}mutation calls: ` +
    `<tspan font-weight="600">clonal</tspan> · subclonal (paler) · indeterminate (grey)</text>`);
  const T = 24;
  const genes = r.panels[0]?.genes.map((g) => g.gene) || [];
  genes.forEach((gene, gi) => {
    const y = T + gi * rowH;
    if (gi % 2 === 0) out.push(`<rect x="0" y="${y - 3}" width="${SIDE_X - 16}" height="${rowH}" fill="${p.line}" opacity="0.3"/>`);
    out.push(`<text x="${LBL}" y="${y + rowH / 2}" font-size="11" font-weight="600" fill="${p.ink}" text-anchor="end">${esc(gene)}</text>`);
    r.panels.forEach((pn, ci) => {
      const g = pn.genes[gi], by = y + ci * subH, col = SERIES[ci % SERIES.length];
      const called = g.clonal + g.subclonal + g.indeterminate;
      if (!g.calls) {
        out.push(`<text x="${BAR_X}" y="${by + 9}" font-size="9.5" fill="${p.muted}">no ${r.measure === "driver" ? "driver " : ""}mutation call with a FACETS estimate</text>`);
        return;
      }
      let x = BAR_X;
      for (const [n, op, fill] of [[g.clonal, 0.95, col], [g.subclonal, 0.4, col], [g.indeterminate, 0.8, p.line]] as [number, number, string][]) {
        if (!n || !called) continue;
        const w = BAR_W * n / called;
        out.push(`<rect x="${num(x)}" y="${by}" width="${num(w)}" height="10" fill="${fill}" opacity="${op}"/>`);
        x += w;
      }
      const clonalPct = g.clonal + g.subclonal ? Math.round(100 * g.clonal / (g.clonal + g.subclonal)) : null;
      out.push(`<text x="${TXT_X}" y="${by + 9}" font-size="9.5" fill="${col}">${clonalPct == null ? "—" : clonalPct + "% clonal"}` +
        `<tspan fill="${p.muted}">&#160;· LOH ${g.lohKnown ? Math.round(100 * g.loh / g.lohKnown) + "%" : "—"} · ${fmt(g.calls)} calls</tspan>` +
        `${ci === 0 && g.q != null ? `<tspan fill="${g.q < 0.05 ? p.ink : p.muted}">&#160;· ${esc(qFmt(g.q))}</tspan>` : ""}</text>`);
    });
  });
  // per cohort: WGD, purity, ploidy
  let sy = T;
  out.push(`<text x="${SIDE_X}" y="14" font-size="10" fill="${p.muted}">per sample (FACETS)</text>`);
  r.panels.forEach((pn, ci) => {
    const col = SERIES[ci % SERIES.length], wgdN = pn.wgd.yes + pn.wgd.no;
    out.push(`<text x="${SIDE_X}" y="${sy + 10}" font-size="11.5" font-weight="600" fill="${col}">${esc(pn.cohort)}</text>`);
    out.push(`<text x="${SIDE_X}" y="${sy + 25}" font-size="10" fill="${p.ink}">whole-genome doubled: ${wgdN ? (100 * pn.wgd.yes / wgdN).toFixed(1) + "%" : "—"}` +
      `<tspan fill="${p.muted}">&#160;of ${fmt(wgdN)} samples</tspan></text>`);
    const hw = (W - SIDE_X - 20) / 2 - 6;
    out.push(`<text x="${SIDE_X}" y="${sy + 40}" font-size="9" fill="${p.muted}">purity 0 → 1</text>` + sparkHist(pn.purity, SIDE_X, sy + 44, hw, 28, col, p));
    out.push(`<text x="${SIDE_X + hw + 12}" y="${sy + 40}" font-size="9" fill="${p.muted}">ploidy 0 → 8</text>` + sparkHist(pn.ploidy, SIDE_X + hw + 12, sy + 44, hw, 28, col, p));
    out.push(`<text x="${SIDE_X}" y="${sy + 86}" font-size="9" fill="${p.muted}">${fmt(pn.ascnSamples)} of ${fmt(pn.samples)} samples have FACETS estimates` +
      `${r.qc ? "; " + fmt(pn.qcPass) + " pass QC" : ""}</text>`);
    sy += 100;
  });
  if (r.wgdP != null) { out.push(`<text x="${SIDE_X}" y="${sy + 4}" font-size="10" fill="${p.ink}">WGD differs: Fisher ${esc(pFmt(r.wgdP))}</text>`); sy += 14; }
  const bottom = Math.max(T + genes.length * rowH, sy) + 8;
  const cap = caption(v.caveat || "", W, bottom, p.muted);
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

