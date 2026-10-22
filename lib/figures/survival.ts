// Kaplan–Meier (or 1 − KM, "cumulative incidence") curves, one per cohort, with the number still
// at risk under each tick (a curve over 40 remaining patients must not look like one over 4,000),
// each cohort's median, size and events in the legend, and the log-rank test under it.
import type { KmCurve, DrawnResultOf } from "../types.ts";
import { survivalAxis } from "../stats.ts";
import { stepPath } from "../chart/marks.ts";
import { plotHeight } from "./common.ts";
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend,
  seriesStyle, fmtInt, fmtMonths, fmtP, fmtNum, label, textWidth, esc, FS, SW, type SvgOpts
} from "../svg-kit.ts";


export function survivalSvg(v: DrawnResultOf<"survival">, o: SvgOpts): string {
  const p = palette(o.theme), W = Math.max(360, o.width || 720);
  const curves = (v.curves || []) as KmCurve[];
  const incidence = v.display === "incidence";
  const { tMax, step } = survivalAxis(curves, { cutoffMonths: v.cutoffMonths, tickMonths: v.tickMonths });

  const T = 12, R = 16, PLOT = plotHeight(W);
  const yTitle = incidence ? "Cumulative incidence" : "Survival probability";
  const ys = linear(0, 1, T + PLOT, T, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const yFmt = (t: number) => Math.round(t * 100) + "%";
  // the risk table's rows are named in the left margin, so the plot starts after the longer of
  // the axis and the names (capped; a longer name is cut, its full text on hover)
  const risk = curves.length > 0 && curves.every((c) => Array.isArray(c.atRisk));
  const nameW = risk ? Math.min(W * 0.14, 180, Math.max(...curves.map((c) => textWidth(c.cohort, FS.small)))) : 0;
  const L = Math.max(8 + leftAxisWidth(ys, yTitle, yFmt), risk ? 8 + 20 + nameW + 10 : 0);
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
  if (risk) { const rt = riskTable(curves, xs, y, W, L, nameW, p); out.push(rt.svg); y += rt.height + 8; }
  const items = curves.map((c, i) => ({
    label: c.cohort, color: seriesStyle(i).color, dash: seriesStyle(i).dash, kind: "line" as const,
    detail: (incidence ? "50% incidence by " : "median ") + (c.median == null ? "not reached" : fmtMonths(c.median)) +
      " · n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " events"
  }));
  const lg = legend(items, 8, y, W - 16, p, { grid: true });
  out.push(lg.svg);
  y += lg.height + 4;

  for (const line of statLines(v)) {
    // the class is how the page (and its e2e) finds the test in the figure
    out.push(label(8, y + FS.body, line, { size: FS.body, fill: p.ink, maxW: W - 16, extra: 'class="logrank"' }));
    y += Math.round(FS.body * 1.6);
  }
  const cap = caption(v.caveat || "", W, y, p.muted);
  out.push(cap.svg);
  return frame(W, y + cap.height + 8, out.join(""), p.bg, false, (incidence ? "Cumulative incidence" : "Kaplan–Meier") + " — " + curves.map((c) => c.cohort).join(", "));
}

/** the tests, in words: the one the reader asked for and, where studies were pooled, the other */
function statLines(v: DrawnResultOf<"survival">): string[] {
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

/**
 * The number at risk under each tick, one row per cohort, named and keyed by its line. Where the
 * counts are wider than the ticks are apart, every second (third, …) tick is printed.
 */
function riskTable(curves: KmCurve[], xs: ReturnType<typeof linear>, y0: number, W: number, L: number, nameW: number,
  p: ReturnType<typeof palette>): { svg: string; height: number } {
  const ROW = Math.round(FS.small * 1.6);
  const at = (c: KmCurve, t: number) => { const a = c.atRisk!; const m = Math.round(t); return m < a.length ? a[m] : 0; };
  const widest = Math.max(...curves.flatMap((c) => xs.ticks.map((t) => textWidth(fmtInt(at(c, t)), FS.small))));
  const gap = xs.ticks.length > 1 ? xs(xs.ticks[1]) - xs(xs.ticks[0]) : Infinity;
  const every = Math.max(1, Math.ceil((widest + 6) / gap));
  const out: string[] = [label(8, y0 + FS.small, "Number at risk", { size: FS.small, fill: p.muted, weight: 600 })];
  curves.forEach((c, i) => {
    const st = seriesStyle(i), cy = y0 + ROW * (i + 1) + ROW / 2, ty = cy + FS.small * 0.35;
    out.push(`<line x1="8" y1="${cy}" x2="24" y2="${cy}" stroke="${st.color}" stroke-width="${SW.series}"` + (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + `/>`);
    out.push(label(28, ty, c.cohort, { size: FS.small, fill: p.ink, maxW: nameW }));
    xs.ticks.forEach((t, k) => {
      if (k % every) return;
      const text = fmtInt(at(c, t)), w = textWidth(text, FS.small), x = xs(t);
      // centred on its tick, pulled in at the right edge
      const left = Math.min(Math.max(x - w / 2, L - 4), W - 4 - w);
      out.push(`<text x="${Math.round(left * 10) / 10}" y="${Math.round(ty * 10) / 10}" font-size="${FS.small}" fill="${p.muted}">` +
        `<title>${esc(c.cohort + ": " + text + " at risk at " + fmtNum(t) + " months")}</title>${text}</text>`);
    });
  });
  return { svg: out.join(""), height: ROW * (curves.length + 1) };
}
