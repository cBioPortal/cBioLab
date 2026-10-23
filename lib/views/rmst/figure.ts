// RMST figure: Kaplan–Meier curves per cohort with the area to τ shaded — one panel per landmark,
// as small multiples — and a table of each cohort's restricted mean with its difference and ratio
// against the first cohort.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, seriesStyle, fmtInt, fmtNum, fmtRatio, fmtP, FS, type SvgOpts } from "../../svg-kit.ts";
import { lineSwatch } from "../../chart/legend.ts";
import { r1 } from "../../chart/marks.ts";
import { kmPanel } from "../../figures/km.ts";
import type { RmstComparison } from "./types.ts";

const mo = (x: number) => fmtNum(Math.round(x * 10) / 10);
/** a restricted mean and its interval: "17.2 mo (16.1–18.3)" */
export const rmstText = (c: { rmst: number; lo: number; hi: number }) => mo(c.rmst) + " mo (" + mo(c.lo) + "–" + mo(c.hi) + ")";
export const rmstDiffText = (c: RmstComparison) => (c.diff >= 0 ? "+" : "") + mo(c.diff) + " mo (" + mo(c.diffLo) + " to " + mo(c.diffHi) + ") " + fmtP(c.diffP);
export const rmstRatioText = (c: RmstComparison) => fmtRatio(c.ratio) + " (" + fmtRatio(c.ratioLo) + "–" + fmtRatio(c.ratioHi) + ")";
const panelTitle = (L: number, tau: number) => (L > 0 ? "From the " + fmtNum(L) + "-month landmark" : "From the start") + " · RMST to τ = " + fmtNum(tau) + " months";

export function rmstSvg(v: DrawnResultOf<"rmst">, o: SvgOpts): string {
  const r = v.rmst, p = palette(o.theme), W = Math.max(420, o.width || 760);
  const out: string[] = [];
  const panels = r.panels;
  const cols = Math.max(1, Math.min(panels.length, Math.floor((W - 16) / 440)));
  const GAP = 20, pw = (W - (cols - 1) * GAP) / cols;
  const xFrom = (L: number) => "Months from " + (L > 0 ? "the landmark" : r.anchoredTo || "the study's day 0");
  let y = 0;
  for (let row = 0; row * cols < panels.length; row++) {
    let rowH = 0;
    panels.slice(row * cols, row * cols + cols).forEach((pn, j) => {
      const km = kmPanel(pn.curves.map((c) => ({ name: c.cohort, points: c.points, atRisk: c.atRisk,
        detail: "RMST " + rmstText(c) + " · n = " + fmtInt(c.n) })),
      { y0: 0, W: pw, p, xTitle: xFrom(pn.landmark), yTitle: "Probability alive", title: panelTitle(pn.landmark, pn.tau), shadeTo: pn.tau,
        tMax: Math.max(pn.tau * 1.5, Math.min(pn.tau * 3, Math.max(1, ...pn.curves.flatMap((c) => c.points.map((q) => q.t))))) });
      out.push(`<g transform="translate(${r1(j * (pw + GAP))},${r1(y)})">${km.svg}</g>`);
      rowH = Math.max(rowH, km.height);
    });
    y += rowH + 8;
  }

  // the table: one block per landmark
  const head = ["cohort", "n", "RMST (95% CI)", "difference (95% CI)", "ratio (95% CI)"];
  const blocks = panels.map((pn) => ({ pn, rows: pn.curves.map((c, i) => {
    const cmp = pn.comparisons.find((x) => x.cohort === c.cohort);
    return { i, cells: [c.cohort, fmtInt(c.n), rmstText(c), i === 0 ? "reference" : cmp ? rmstDiffText(cmp) : "–", i === 0 ? "" : cmp ? rmstRatioText(cmp) : "–"] };
  }) }));
  const all = blocks.flatMap((b) => b.rows);
  const nameW = Math.min(W * 0.3, Math.max(textWidth(head[0], FS.small), ...all.map((x) => textWidth(x.cells[0], FS.body) + 22)));
  const colW = [1, 2, 3, 4].map((k) => Math.max(textWidth(head[k], FS.small), ...all.map((x) => textWidth(x.cells[k], FS.body))));
  const CG = 14;
  const fits = 8 + nameW + colW.reduce((a, w) => a + w + CG, 0) <= W - 8;
  // narrow: n and RMST on the first line, difference and ratio under them
  const colX: number[] = [];
  let cx = 8 + nameW + CG;
  colW.forEach((w, k) => { colX.push(cx); cx += w + CG; if (!fits && k === 1) cx = 8 + nameW + CG; });
  const cellW = (k: number) => !fits && k === 3 ? W - colX[k] - 8 : colW[k];
  const ROW = fits ? 18 : 30;
  for (const b of blocks) {
    out.push(label(8, y + FS.body, panelTitle(b.pn.landmark, b.pn.tau) + (b.pn.tauSet ? "" : " (every cohort ≥ 10 at risk)"), { size: FS.body, fill: p.ink, weight: 600, maxW: W - 16 }));
    y += FS.body + 6;
    head.forEach((h, k) => {
      const line2 = !fits && k >= 3;
      out.push(label(k === 0 ? 8 : colX[k - 1], y + FS.small + (line2 ? FS.small + 4 : 0), h, { size: FS.small, fill: p.muted, maxW: k === 0 ? nameW : cellW(k - 1) }));
    });
    y += FS.small + 6 + (fits ? 0 : FS.small + 4);
    for (const x of b.rows) {
      const base = y + FS.body, st = seriesStyle(x.i);
      out.push(lineSwatch(8, base - FS.body * 0.35, st.color, st.dash));
      out.push(label(30, base, x.cells[0], { size: FS.body, fill: p.ink, maxW: nameW - 22 }));
      x.cells.slice(1).forEach((t, k) => {
        if (!t) return;
        const line2 = !fits && k >= 2;
        out.push(label(colX[k], base + (line2 ? 13 : 0), t, { size: line2 ? FS.small : FS.body, fill: k === 0 ? p.muted : p.ink, maxW: cellW(k) }));
      });
      y += ROW;
    }
    y += 8;
  }
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, "Restricted mean survival time — " + r.endpointLabel);
}
