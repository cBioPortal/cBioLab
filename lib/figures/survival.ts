// Kaplan–Meier (or 1 − KM, "cumulative incidence") curves, one per cohort, with each cohort's
// median, size and events in the legend and the log-rank test under it.
import type { ViewResult, KmCurve } from "../types.ts";
import { survivalAxis } from "../stats.ts";
import { stepPath } from "../chart/marks.ts";
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend,
  seriesStyle, fmtInt, fmtMonths, fmtP, fmtNum, label, FS, SW, type SvgOpts
} from "../svg-kit.ts";

/** the plot's height for a figure `w` wide: a landscape panel, neither a strip nor a square */
export const plotHeight = (w: number) => Math.round(Math.max(200, Math.min(320, w * 0.32)));

export function survivalSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = Math.max(360, o.width || 720);
  const curves = (v.curves || []) as KmCurve[];
  const incidence = v.display === "incidence";
  const { tMax, step } = survivalAxis(curves, { cutoffMonths: v.cutoffMonths, tickMonths: v.tickMonths });

  const T = 12, R = 16, PLOT = plotHeight(W);
  const yTitle = incidence ? "Cumulative incidence" : "Survival probability";
  const ys = linear(0, 1, T + PLOT, T, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const yFmt = (t: number) => Math.round(t * 100) + "%";
  const L = 8 + leftAxisWidth(ys, yTitle, yFmt);
  const xs = linear(0, tMax, L, W - R, { nice: false });
  xs.ticks = [];
  for (let t = 0; t <= tMax + 1e-9; t += step) xs.ticks.push(t);
  const xTitle = "Months" + (v.anchoredTo ? " from " + v.anchoredTo : "");

  const out: string[] = [];
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R, fmt: yFmt }));
  out.push(axisBottom(xs, T + PLOT, p, { title: xTitle, minX: 0, maxX: W, fmt: (t) => fmtNum(t) }));
  curves.forEach((c, i) => {
    const st = seriesStyle(i);
    const d = stepPath(c.points.filter((q) => q.t <= tMax), xs, ys, { t: 0, s: incidence ? 0 : 1 }, tMax);
    out.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
  });

  let y = T + PLOT + bottomAxisHeight(xTitle) + 10;
  const items = curves.map((c, i) => ({
    label: c.cohort, color: seriesStyle(i).color, dash: seriesStyle(i).dash, kind: "line" as const,
    detail: (incidence ? "50% by " : "median ") + (c.median == null ? "not reached" : fmtMonths(c.median)) +
      " · n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " events"
  }));
  const lg = legend(items, 8, y, W - 16, p, { grid: true });
  out.push(lg.svg);
  y += lg.height + 4;

  for (const line of statLines(v)) {
    out.push(label(8, y + FS.body, line, { size: FS.body, fill: p.ink, maxW: W - 16 }));
    y += Math.round(FS.body * 1.6);
  }
  const cap = caption(v.caveat || "", W, y, p.muted);
  out.push(cap.svg);
  return frame(W, y + cap.height + 8, out.join(""), p.bg, false, (incidence ? "Cumulative incidence" : "Kaplan–Meier") + " — " + curves.map((c) => c.cohort).join(", "));
}

/** the tests, in words: the one the reader asked for and, where studies were pooled, the other */
function statLines(v: ViewResult): string[] {
  const lines: string[] = [];
  const strat = (s: number) => s > 1 ? " · stratified by study, " + s + " strata" : "";
  const disagree = (a: number, b: number) => (a < 0.05) !== (b < 0.05) ? " — the two disagree at p = 0.05" : "";
  if (v.logrank) lines.push("log-rank χ² = " + fmtNum(v.logrank.chi2) + " (" + v.logrank.df + " df) · " + fmtP(v.logrank.p) + strat(v.logrank.strata) +
    (v.logrankPooled ? " · pooled " + fmtP(v.logrankPooled.p) + disagree(v.logrank.p, v.logrankPooled.p) : ""));
  if (v.logrankK) lines.push(v.logrankK.groups + "-group log-rank χ² = " + fmtNum(v.logrankK.chi2) + " (" + v.logrankK.df + " df) · " + fmtP(v.logrankK.p) +
    strat(v.logrankK.strata) + (v.logrankKPooled ? " · pooled " + fmtP(v.logrankKPooled.p) + disagree(v.logrankK.p, v.logrankKPooled.p) : "") +
    " — whether the groups differ at all, not which pair does");
  return lines;
}
