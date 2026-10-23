// Multistate figure: per cohort the share of patients in each state over time (Aalen–Johansen,
// stacked), the Nelson–Aalen cumulative hazard of each transition with one line per cohort, and a
// table of each transition's events, rate and hazard ratio against the first cohort.
import type { DrawnResultOf } from "../../types.ts";
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend, label, textWidth,
  seriesStyle, fmtInt, fmtNum, fmtPct, fmtRatio, fmtP, FS, SW, SERIES, OTHER, type SvgOpts,
} from "../../svg-kit.ts";
import { stepPath, r1 } from "../../chart/marks.ts";
import { timeScale } from "../../chart/time.ts";
import { lineSwatch } from "../../chart/legend.ts";
import type { MultistateTransitionKey } from "./types.ts";

/** the three states: alive without progression, alive after it, dead */
export const MS_STATES = [
  { label: "alive, not progressed", color: SERIES[5] },
  { label: "alive, progressed", color: SERIES[1] },
  { label: "dead", color: OTHER },
] as const;

export const MS_TRANSITIONS: Record<MultistateTransitionKey, string> = {
  "01": "start → progression", "02": "start → death (no progression)", "12": "progression → death",
};

/** the corners of a step function of (t, v) from t = 0 to tEnd */
function stepCorners(pts: { t: number; v: number }[], x: (t: number) => number, y: (v: number) => number, tEnd: number): [number, number][] {
  const out: [number, number][] = [[x(0), y(pts.length ? pts[0].v : 0)]];
  let level = out[0][1], lastX = out[0][0];
  for (const q of pts.slice(1)) {
    const nx = x(q.t), ny = y(q.v);
    if (nx - lastX < 0.5) out[out.length - 1][1] = ny;
    else { out.push([nx, level], [nx, ny]); lastX = nx; }
    level = ny;
  }
  out.push([Math.max(lastX, x(tEnd)), level]);
  return out;
}
const poly = (v: [number, number][]) => "M" + v.map(([a, b]) => r1(a) + " " + r1(b)).join("L") + "Z";

export const msRateText = (r: { rate: number; lo: number | null; hi: number | null }) =>
  fmtNum(r.rate, 2) + (r.lo != null && r.hi != null ? " (" + fmtNum(r.lo, 2) + "–" + fmtNum(r.hi, 2) + ")" : "");

export function multistateSvg(v: DrawnResultOf<"multistate">, o: SvgOpts): string {
  const m = v.multistate, p = palette(o.theme), W = Math.max(420, o.width || 760);
  const out: string[] = [];
  const xTitle = "Months from " + m.origin;
  let y = 4;

  // state occupation: one stacked panel per cohort
  out.push(label(8, y + FS.title, "Share of patients in each state (Aalen–Johansen)", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  y += FS.title + 6;
  const key = legend(MS_STATES.map((s) => ({ label: s.label, color: s.color })), 8, y, W - 16, p, { size: FS.small });
  out.push(key.svg); y += key.height + 2;
  const cols = W >= 720 && m.cohorts.length > 1 ? 2 : 1, GAPX = 20;
  const pw = (W - 16 - GAPX * (cols - 1)) / cols, ph = Math.round(Math.max(150, Math.min(220, pw * 0.45)));
  const panelH = FS.body + 8 + ph + bottomAxisHeight(xTitle) + 6;
  m.cohorts.forEach((c, i) => {
    const x0 = 8 + (i % cols) * (pw + GAPX), y0 = y + Math.floor(i / cols) * panelH;
    const g: string[] = [];
    g.push(lineSwatch(0, FS.body * 0.6, seriesStyle(i).color, seriesStyle(i).dash));
    g.push(label(24, FS.body, c.cohort + " · n = " + fmtInt(c.n), { size: FS.body, fill: p.ink, weight: 600, maxW: pw - 24 }));
    const T = FS.body + 8;
    const ys = linear(0, 100, T + ph, T, { nice: false });
    ys.ticks = [0, 25, 50, 75, 100];
    const yFmt = (t: number) => t + "%";
    const L = leftAxisWidth(ys, undefined, yFmt) + 4;
    const xs = timeScale(0, m.tMax, L, pw - 8);
    g.push(axisLeft(ys, L, p, { fmt: yFmt }));
    g.push(axisBottom(xs, T + ph, p, { title: xTitle, minX: 0, maxX: pw }));
    if (c.occupation.length) {
      const yv = (f: number) => ys(Math.max(0, Math.min(1, f)) * 100);
      const end = c.drawnTo;
      const b1 = stepCorners(c.occupation.map((q) => ({ t: q.t, v: q.p0 })), xs, yv, end);
      const b2 = stepCorners(c.occupation.map((q) => ({ t: q.t, v: q.p0 + q.p1 })), xs, yv, end);
      const base: [number, number][] = [[xs(0), yv(0)], [xs(end), yv(0)]];
      const top: [number, number][] = [[xs(0), yv(1)], [xs(end), yv(1)]];
      g.push(`<path d="${poly([...b1, ...base.slice().reverse()])}" fill="${MS_STATES[0].color}" opacity="0.85"><title>alive, not progressed</title></path>`);
      g.push(`<path d="${poly([...b2, ...b1.slice().reverse()])}" fill="${MS_STATES[1].color}" opacity="0.85"><title>alive, progressed</title></path>`);
      g.push(`<path d="${poly([...top, ...b2.slice().reverse()])}" fill="${MS_STATES[2].color}" opacity="0.7"><title>dead</title></path>`);
    }
    out.push(`<g transform="translate(${r1(x0)},${r1(y0)})">${g.join("")}</g>`);
  });
  y += Math.ceil(m.cohorts.length / cols) * panelH + 4;

  // occupation at the horizons
  for (const [i, c] of m.cohorts.entries()) {
    const text = c.cohort + ": " + c.atHorizon.map((h) => fmtNum(h.months) + " mo " + (h.p0 == null ? "— (fewer than 10 followed)"
      : fmtPct(h.p0 * 100, 0) + " / " + fmtPct(h.p1! * 100, 0) + " / " + fmtPct(h.p2! * 100, 0))).join(" · ");
    out.push(lineSwatch(8, y + FS.small * 0.6, seriesStyle(i).color, seriesStyle(i).dash));
    out.push(label(32, y + FS.small, text, { size: FS.small, fill: p.muted, maxW: W - 40 }));
    y += Math.round(FS.small * 1.6);
  }
  out.push(label(8, y + FS.small, "(not progressed / progressed / dead)", { size: FS.small, fill: p.muted, maxW: W - 16 }));
  y += Math.round(FS.small * 1.6) + 8;

  // cumulative hazards: one panel per transition
  out.push(label(8, y + FS.title, "Cumulative hazard of each transition (Nelson–Aalen)", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  y += FS.title + 8;
  const keys: MultistateTransitionKey[] = ["01", "02", "12"];
  const hcols = W >= 760 ? 3 : 1, hw = (W - 16 - GAPX * (hcols - 1)) / hcols, hh = Math.round(Math.max(130, Math.min(190, hw * 0.55)));
  const hPanel = FS.body + 6 + hh + bottomAxisHeight("Months") + 6;
  keys.forEach((k, j) => {
    const x0 = 8 + (j % hcols) * (hw + GAPX), y0 = y + Math.floor(j / hcols) * hPanel;
    const g: string[] = [];
    g.push(label(0, FS.body, MS_TRANSITIONS[k], { size: FS.body, fill: p.ink, weight: 600, maxW: hw }));
    const T = FS.body + 6;
    const peak = Math.max(0.05, ...m.cohorts.flatMap((c) => c.cumhaz[k].map((q) => q.h)));
    const ys = linear(0, peak, T + hh, T);
    const L = leftAxisWidth(ys) + 4;
    const xs = timeScale(0, m.tMax, L, hw - 8);
    g.push(axisLeft(ys, L, p, { gridTo: hw - 8 }));
    g.push(axisBottom(xs, T + hh, p, { title: "Months", minX: 0, maxX: hw }));
    m.cohorts.forEach((c, i) => {
      const st = seriesStyle(i), pts = c.cumhaz[k];
      if (pts.length < 2) return;
      g.push(`<path d="${stepPath(pts.slice(1).map((q) => ({ t: q.t, s: q.h })), xs, ys, { t: 0, s: 0 }, c.drawnTo)}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
        (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
    });
    out.push(`<g transform="translate(${r1(x0)},${r1(y0)})">${g.join("")}</g>`);
  });
  y += Math.ceil(keys.length / hcols) * hPanel + 4;

  // the table: per transition and cohort, events / person-months, rate, hazard ratio
  const head = ["transition · cohort", "events", "person-months", "per 100 person-months (95% CI)", m.cohorts.length > 1 ? "HR vs " + m.reference : ""];
  const rows: { cells: string[]; color?: number; header?: boolean }[] = [];
  for (const k of keys) {
    rows.push({ cells: [MS_TRANSITIONS[k]], header: true });
    const cx = m.cox.find((q) => q.key === k);
    m.cohorts.forEach((c, i) => {
      const r = c.rates.find((q) => q.key === k)!;
      const hr = cx?.rows.find((q) => q.cohort === c.cohort);
      rows.push({ color: i, cells: [c.cohort, fmtInt(r.events), fmtInt(r.personMonths), msRateText(r),
        m.cohorts.length < 2 ? "" : i === 0 ? "reference" : hr ? fmtRatio(hr.hr) + " (" + fmtRatio(hr.lo) + "–" + fmtRatio(hr.hi) + ") " + fmtP(hr.p) : cx?.noFit ? "not fitted" : "–"] });
    });
    if (cx?.noFit) rows.push({ cells: ["  no hazard ratio: " + cx.noFit] });
  }
  const nameW = Math.min(W * 0.34, Math.max(...rows.filter((r) => !r.header && r.cells.length > 1).map((r) => textWidth(r.cells[0], FS.body) + 22), textWidth(head[0], FS.small)));
  const colW = [1, 2, 3, 4].map((ci) => Math.max(textWidth(head[ci], FS.small), ...rows.filter((r) => r.cells.length > 1).map((r) => textWidth(r.cells[ci] || "", FS.body))));
  const GAP = 14;
  const fits = 8 + nameW + colW.reduce((a, w) => a + w + GAP, 0) <= W - 8;
  const colX: number[] = [];
  let cxp = 8 + nameW + GAP;
  colW.forEach((w, ci) => { colX.push(cxp); cxp += w + GAP; if (!fits && ci === 1) cxp = 8 + nameW + GAP; });
  const ROW = fits ? 18 : 30;
  const cellW = (ci: number) => !fits && ci >= 2 ? (ci === 3 ? W - colX[ci] - 8 : colW[ci]) : colW[ci];
  head.forEach((h, ci) => {
    if (!h) return;
    const line2 = !fits && ci >= 3;
    out.push(label(ci === 0 ? 8 : colX[ci - 1], y + FS.small + (line2 ? FS.small + 4 : 0), h, { size: FS.small, fill: p.muted, maxW: ci === 0 ? nameW : cellW(ci - 1) }));
  });
  y += FS.small + 6 + (fits ? 0 : FS.small + 4);
  for (const r of rows) {
    if (r.header) { out.push(label(8, y + FS.body + 2, r.cells[0], { size: FS.body, fill: p.ink, weight: 600, maxW: W - 16 })); y += 20; continue; }
    if (r.cells.length === 1) { out.push(label(8, y + FS.small, r.cells[0].trim(), { size: FS.small, fill: p.muted, maxW: W - 16 })); y += 16; continue; }
    const base = y + FS.body;
    const st = seriesStyle(r.color!);
    out.push(lineSwatch(8, base - FS.body * 0.35, st.color, st.dash));
    out.push(label(30, base, r.cells[0], { size: FS.body, fill: p.ink, maxW: nameW - 22 }));
    r.cells.slice(1).forEach((t, ci) => {
      if (!t) return;
      const line2 = !fits && ci >= 2;
      out.push(label(colX[ci], base + (line2 ? 13 : 0), t, { size: line2 ? FS.small : FS.body, fill: ci >= 2 ? p.ink : p.muted, maxW: cellW(ci) }));
    });
    y += ROW;
  }
  y += 6;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, "Multistate model — " + m.cohorts.map((c) => c.cohort).join(", "));
}
