// The clinical course: small multiples, one panel per event type, one line per cohort.
import type { CourseSeries, DrawnResultOf } from "../types.ts";
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend, label, textWidth,
  seriesStyle, fmtInt, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import { timeScale } from "../chart/time.ts";
import { lineSwatch } from "../chart/legend.ts";
import { r1 } from "../chart/marks.ts";

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
export function courseSvg(v: DrawnResultOf<"course">, o: SvgOpts): string {
  const p = palette(o.theme), W = Math.max(420, o.width || 720);
  const series = (v.course || []) as CourseSeries[];
  const axis = v.courseAxis || { binMonths: 3, from: -12, to: 60 };
  const cohortNames = [...new Set(series.map((s) => s.cohort))];
  const panels = [...new Set(series.map((s) => s.eventType))];
  const truncated = series.some((s) => s.points.some((q) => q.atRisk > 0 && q.atRisk < RISK_FLOOR));

  // one time scale for every panel and the risk table under them; its step leaves room for the counts
  const PANEL = Math.round(Math.max(100, Math.min(160, W * 0.12)));
  const ys = linear(0, 100, PANEL, 0, { nice: false });
  ys.ticks = [0, 50, 100];
  const yFmt = (t: number) => t + "%";
  const L = 8 + Math.max(leftAxisWidth(ys, undefined, yFmt), 18 + 6), R = 16;
  const widest = Math.max(textWidth("–", FS.small), ...series.flatMap((s) => s.points.map((q) => textWidth(fmtInt(q.atRisk), FS.small))));
  const xs = timeScale(axis.from, axis.to, L, W - R, { minGap: widest });
  const xTitle = "Months from the anchor event";

  const out: string[] = [];
  const HEAD = FS.title + 12;
  let y = 4;
  panels.forEach((et) => {
    const isInterval = series.find((s) => s.eventType === et)?.isInterval;
    const sub = " — % " + (isInterval ? "in this state" : "with an event");
    const etW = Math.min(textWidth(et, FS.title, 600), (W - 16) * 0.6);
    out.push(label(8, y + FS.title, et, { size: FS.title, fill: p.ink, weight: 600, maxW: etW }));
    out.push(label(8 + etW + 2, y + FS.title, sub, { size: FS.body, fill: p.muted, maxW: W - 16 - etW - 2 }));
    const top = y + HEAD;
    const py = linear(0, 100, top + PANEL, top, { nice: false });
    py.ticks = ys.ticks;
    for (const t of xs.ticks) out.push(`<line x1="${r1(xs(t))}" y1="${top}" x2="${r1(xs(t))}" y2="${top + PANEL}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    out.push(axisLeft(py, L, p, { gridTo: W - R, fmt: yFmt }));
    // the anchor is the whole point of the alignment, so mark t = 0
    if (axis.from < 0) out.push(`<line x1="${r1(xs(0))}" y1="${top}" x2="${r1(xs(0))}" y2="${top + PANEL}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
    cohortNames.forEach((cn, ci) => {
      const s = series.find((z) => z.cohort === cn && z.eventType === et);
      if (!s) return;
      const pts = s.points.filter((q) => q.pct != null && q.atRisk >= RISK_FLOOR);
      if (!pts.length) return;
      const st = seriesStyle(ci);
      out.push(`<path d="${pts.map((q, i) => (i ? "L" : "M") + r1(xs(q.t)) + " " + r1(py(q.pct!))).join("")}" ` +
        `fill="none" stroke="${st.color}" stroke-width="${SW.series}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""} stroke-linejoin="round"/>`);
    });
    y = top + PANEL + 10;
  });
  // one time axis, under the last panel
  y -= 10;
  out.push(axisBottom(xs, y, p, { title: xTitle, minX: 0, maxX: W }));
  y += bottomAxisHeight(xTitle) + 8;

  // the risk table: the denominator, printed at the axis's ticks. It depends only on cohort and bin.
  out.push(label(8, y + FS.small, "patients still observable", { size: FS.small, fill: p.muted }));
  y += FS.small + 4;
  const RROW = FS.small + 6;
  cohortNames.forEach((cn, ci) => {
    const s = series.find((z) => z.cohort === cn);
    const st = seriesStyle(ci), base = y + RROW / 2 + FS.small * 0.35;
    out.push(lineSwatch(8, y + RROW / 2, st.color, st.dash));
    for (const t of xs.ticks) {
      const q = s?.points.find((z) => z.t === t);
      const text = q ? fmtInt(q.atRisk) : "–", w = textWidth(text, FS.small);
      const cx = Math.min(Math.max(xs(t), 8 + 18 + 6 + w / 2), W - 4 - w / 2);
      out.push(label(cx, base, text, { size: FS.small, fill: p.muted, anchor: "middle" }));
    }
    y += RROW;
  });
  y += 8;

  // always legended, as survivalSvg is: a figure that travels alone must name its cohorts
  const lg = legend(cohortNames.map((cn, ci) => ({ label: cn, color: seriesStyle(ci).color, dash: seriesStyle(ci).dash, kind: "line" as const })), 8, y, W - 16, p);
  out.push(lg.svg);
  y += lg.height + 4;
  const foot = truncated ? " Lines stop where fewer than " + RISK_FLOOR + " patients remain observable." : "";
  const cap = caption((v.caveat || "") + foot, W, y, p.muted);
  out.push(cap.svg);
  return frame(W, y + cap.height + 8, out.join(""), p.bg, false, "Clinical course — " + panels.join(", ") + " — " + cohortNames.join(", "));
}
