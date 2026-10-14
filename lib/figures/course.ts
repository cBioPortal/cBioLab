// The clinical course: small multiples, one panel per event type, one line per cohort.
import type { ViewResult, CourseSeries } from "../types.ts";
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";

/**
 * The clinical course: small multiples, one panel per event type, one line per
 * cohort. Two things the picture must not hide.
 *
 * The at-risk denominator is printed under the axis the way a KM figure prints
 * its risk table — a curve over 40 remaining patients should not look like a
 * curve over 24,000. It depends only on cohort and bin, never on event type, so
 * it is written once rather than per panel.
 *
 * And the line STOPS where fewer than RISK_FLOOR patients remain observable,
 * with the truncation stated rather than left to be inferred from a line that
 * simply gets noisy.
 */
export const RISK_FLOOR = 10;
export function courseSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const series = (v.course || []) as CourseSeries[];
  const axis = v.courseAxis || { binMonths: 3, from: -12, to: 60 };
  const cohortNames = [...new Set(series.map((s) => s.cohort))];
  const panels = [...new Set(series.map((s) => s.eventType))];
  // Layout: each panel owns HEAD (its title) + PANEL (the plot) + FOOT (its axis
  // labels). Right padding must clear a centred "60mo" and a risk figure, both
  // of which sit ON the last tick rather than left of it.
  const L = 46, R = 30, T = 6, HEAD = 21, PANEL = 120, FOOT = 20;
  const BLOCK = HEAD + PANEL + FOOT;
  const riskH = 14 * cohortNames.length + 18;
  // Always legended, as survivalSvg is: rasterised into a chat the figure stands
  // alone, and one that does not name its cohort is anonymous.
  const legendH = 16 * cohortNames.length + 8;
  const plotsH = panels.length * BLOCK;
  const truncated = series.some((s) => s.points.some((q) => q.atRisk > 0 && q.atRisk < RISK_FLOOR));
  const foot = (truncated ? " Lines stop where fewer than " + RISK_FLOOR + " patients remain observable." : "");
  const cap = caption((v.caveat || "") + foot, W, T + plotsH + riskH + legendH + 6, p.muted);
  const H = T + plotsH + riskH + legendH + cap.height + 14;

  const x = (t: number) => L + (W - L - R) * (t - axis.from) / Math.max(1, axis.to - axis.from);
  const out: string[] = [];

  panels.forEach((et, pi) => {
    const top = T + pi * BLOCK + HEAD;
    const y = (pct: number) => top + PANEL * (1 - pct / 100);
    const isInterval = series.find((s) => s.eventType === et)?.isInterval;
    out.push(`<text x="8" y="${top - 5}" font-size="11" font-weight="600" fill="${p.ink}">${esc(et)}` +
      `<tspan font-weight="400" fill="${p.muted}"> — % ${isInterval ? "in this state" : "with an event"}</tspan></text>`);
    for (const pct of [0, 50, 100]) {
      out.push(`<line x1="${L}" y1="${num(y(pct))}" x2="${W - R}" y2="${num(y(pct))}" stroke="${p.line}" stroke-width="1"/>`);
      out.push(`<text x="8" y="${num(y(pct) + 3)}" font-size="10" fill="${p.muted}">${pct}%</text>`);
    }
    // The anchor is the whole point of the alignment, so mark t=0 explicitly.
    if (axis.from < 0) out.push(`<line x1="${num(x(0))}" y1="${top}" x2="${num(x(0))}" y2="${top + PANEL}" ` +
      `stroke="${p.muted}" stroke-width="1" stroke-dasharray="3 3"/>`);
    const step = axis.to - axis.from > 72 ? 24 : 12;
    for (let t = Math.ceil(axis.from / step) * step; t <= axis.to; t += step)
      out.push(`<text x="${num(x(t))}" y="${top + PANEL + 13}" font-size="10" text-anchor="middle" fill="${p.muted}">${t}mo</text>`);
    cohortNames.forEach((cn, ci) => {
      const s = series.find((z) => z.cohort === cn && z.eventType === et);
      if (!s) return;
      const pts = s.points.filter((q) => q.pct != null && q.atRisk >= RISK_FLOOR);
      if (!pts.length) return;
      out.push(`<path d="${pts.map((q, i) => (i ? "L" : "M") + " " + num(x(q.t)) + " " + num(y(q.pct!))).join(" ")}" ` +
        `fill="none" stroke="${SERIES[ci % SERIES.length]}" stroke-width="2"/>`);
    });
  });

  // Risk table: the denominator, printed. Sits below the last panel's own axis
  // labels (each block already reserves FOOT for those).
  const rt = T + plotsH + 10;
  out.push(`<text x="8" y="${rt}" font-size="10" fill="${p.muted}">patients still observable</text>`);
  const step = axis.to - axis.from > 72 ? 24 : 12;
  cohortNames.forEach((cn, ci) => {
    const s = series.find((z) => z.cohort === cn);
    const ry = rt + 13 + ci * 14;
    out.push(`<rect x="8" y="${ry - 7}" width="7" height="7" rx="1.5" fill="${SERIES[ci % SERIES.length]}"/>`);
    for (let t = Math.ceil(axis.from / step) * step; t <= axis.to; t += step) {
      const q = s?.points.find((z) => z.t === t);
      out.push(`<text x="${num(x(t))}" y="${ry}" font-size="9" text-anchor="middle" fill="${p.muted}">${q ? fmt(q.atRisk) : "-"}</text>`);
    }
  });
  cohortNames.forEach((cn, ci) => {
    const ly = rt + riskH + ci * 16;
    out.push(`<rect x="8" y="${ly - 8}" width="9" height="9" rx="2" fill="${SERIES[ci % SERIES.length]}"/>`);
    out.push(`<text x="22" y="${ly}" font-size="11" fill="${p.ink}">${esc(cn)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

