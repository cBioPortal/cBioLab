// The compare view's figure.
import { PAD, GUT, titleLine, r1, sentence } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts, LegendItem } from "../../svg-kit.ts";
import { palette, seriesStyle, legend, FS, fmtQ, textWidth, linear, SW, label, fmtPct, fmtInt, esc, axisBottom, fmtNum, bottomAxisHeight, caption, frame } from "../../svg-kit.ts";
import type { CompareRow } from "./types.ts";

/** below this a column of groups is too narrow to read; more width adds columns */
const COL_MIN = 340;

/**
 * Altered %, grouped by gene: one bar per cohort in each gene's group, the cohorts keyed once in
 * a legend. Genes flow down columns as the width allows, every column on one shared scale.
 */
export function compareSvg(v: DrawnResultOf<"compare">, o: SvgOpts): string {
  const p = palette(o.theme);
  const rows = (v.rows || []) as CompareRow[];
  const names = v.cohorts && v.cohorts.length ? v.cohorts : (rows[0]?.cells || []).map((c) => c.cohort);
  const k = Math.max(1, ...rows.map((r) => r.cells.length));
  let W = Math.max(360, o.width || 720);
  const grown = W < COL_MIN + 2 * PAD;
  if (grown) W = COL_MIN + 2 * PAD;
  const title = "Altered %, by cohort";

  const out: string[] = [];
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  const items: LegendItem[] = names.map((n, i) => ({ label: n, color: seriesStyle(i).color, opacity: seriesStyle(i).tint }));
  const lg = legend(items, PAD, y, W - 2 * PAD, p, { grid: names.length > 4 });
  out.push(lg.svg);
  y += lg.height + 8;

  // one bar per cohort, a gap between genes; the gene's name and q head its group on the left
  const BAR = k > 6 ? 10 : 12, GAP = 10;
  const groupH = Math.max(k * BAR, FS.body + FS.small + 6) + GAP;
  const cols = Math.max(1, Math.min(Math.ceil(rows.length / 4), Math.floor((W - 2 * PAD + GUT * 2) / (COL_MIN + GUT * 2))));
  const perCol = Math.ceil(rows.length / cols);
  const colW = (W - 2 * PAD - (cols - 1) * GUT * 2) / cols;
  const qText = (r: CompareRow) => r.qAny != null ? fmtQ(r.qAny) : "";
  const geneW = Math.max(...rows.map((r) => Math.max(textWidth(r.gene, FS.body, 600), textWidth(qText(r), FS.small))), 30);
  const valW = textWidth("100.0%", FS.small) + 4;
  const top = y, plotH = perCol * groupH;
  const maxPct = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.anyPct ?? 0)));
  let notProfiled = 0;

  for (let c = 0; c < cols; c++) {
    const cx = PAD + c * (colW + GUT * 2);
    const L = cx + geneW + GUT, R = cx + colW - valW;
    const xs = linear(0, Math.min(100, maxPct), L, R);
    for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + plotH}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    rows.slice(c * perCol, (c + 1) * perCol).forEach((r, gi) => {
      const gy = top + gi * groupH;
      out.push(label(cx, gy + FS.body, r.gene, { size: FS.body, weight: 600, fill: p.ink, maxW: geneW }));
      const q = qText(r);
      if (q) out.push(label(cx, gy + FS.body + FS.small + 3, q, { size: FS.small, fill: r.qAny! < 0.05 ? p.ink : p.muted }));
      r.cells.forEach((cell, ci) => {
        const st = seriesStyle(ci), by = gy + ci * BAR;
        const pct = cell.anyPct;
        const tip = (names[ci] || cell.cohort) + " — " + r.gene + ": " + (pct == null ? "not profiled" : fmtPct(pct) + " (" + fmtInt(cell.any) + " of " + fmtInt(cell.profiled) + " profiled)");
        if (pct == null) {
          notProfiled++;
          out.push(label(L + 2, by + BAR / 2 + FS.small * 0.35, "not profiled", { size: FS.small, fill: p.muted }));
          return;
        }
        const w = Math.max(pct > 0 ? 1 : 0, xs(pct) - L);
        out.push(`<rect x="${r1(L)}" y="${r1(by + 1)}" width="${r1(w)}" height="${BAR - 2}" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}` +
          `><title>${esc(tip)}</title></rect>`);
        out.push(label(L + w + 3, by + BAR / 2 + FS.small * 0.35, fmtPct(pct), { size: FS.small, fill: p.muted }));
      });
    });
    out.push(`<line x1="${r1(L)}" y1="${top}" x2="${r1(L)}" y2="${top + plotH}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    out.push(axisBottom(xs, top + plotH, p, { title: "altered, % of profiled", minX: L - GUT, maxX: cx + colW, fmt: (x) => fmtNum(x) + "%" }));
  }
  y = top + plotH + bottomAxisHeight("altered") + 8;
  const note = sentence(v.note || "") + (notProfiled ? " " + fmtInt(notProfiled) + " cohort–gene pair" + (notProfiled === 1 ? " was" : "s were") + " not profiled and " + (notProfiled === 1 ? "has" : "have") + " no bar." : "") +
    (rows.some((r) => r.qAny != null) ? " The q under each gene compares its altered share across the cohorts." : "");
  const cap = caption(note, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title + " — " + names.join(", "));
}
