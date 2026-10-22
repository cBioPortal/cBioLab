// Labs figure: a lab value's course from a treatment start, and the response waterfall.
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, label, textWidth,
  seriesStyle, fmtInt, fmtPct, fmtP, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import type { DrawnResultOf } from "../types.ts";
import { timeScale, timeTitle } from "../chart/time.ts";
import { paragraph } from "../chart/text.ts";
import { r1 } from "../chart/marks.ts";

/** The labs course draws a bin only from this many patients; the engine's caption says so. */
export const LAB_MIN_POINT_N = 5;

/** side by side from this width; stacked (course above, waterfalls below) under it */
const SIDE_BY_SIDE = 860;
const WATERFALL_H = 96;

export function labsSvg(v: DrawnResultOf<"labs">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.labs;
  const W = Math.max(420, o.width || 960);
  const side = W >= SIDE_BY_SIDE;
  const out: string[] = [];
  const signed = (fmt: (n: number) => string) => (t: number) => (t > 0 ? "+" : "") + fmt(t) + "%";

  // the course: median and interquartile band of % change, per cohort
  const CW = side ? Math.round(W * 0.52) : W;
  const T = 26, PH = Math.round(Math.max(200, Math.min(300, CW * 0.45)));
  const hi = Math.min(300, Math.max(50, ...r.panels.flatMap((pn) => pn.course.map((c) => c.q3 ?? 0))));
  const ys = linear(-100, hi, T + PH, T, { count: 5 });
  const yFmt = signed(ys.fmt), yTitle = "% change from baseline";
  const L = 8 + leftAxisWidth(ys, yTitle, yFmt);
  const xs = timeScale(r.fromWeeks, r.toWeeks, L, CW - 12, { unit: "weeks" });
  const xTitle = timeTitle("Weeks", r.anchoredTo);
  const clampY = (pc: number) => ys(Math.max(ys.domain[0], Math.min(ys.domain[1], pc)));
  out.push(label(L, 14, r.test + ", % change from baseline", { size: FS.title, fill: p.ink, weight: 600, maxW: CW - L - 8 }));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: CW - 12, fmt: yFmt }));
  out.push(`<line x1="${L}" y1="${r1(ys(0))}" x2="${CW - 12}" y2="${r1(ys(0))}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  out.push(axisBottom(xs, T + PH, p, { title: xTitle, minX: 0, maxX: CW }));
  const drop = r1(clampY(-r.responseDrop));
  out.push(`<line x1="${L}" y1="${drop}" x2="${CW - 12}" y2="${drop}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="4 3"/>` +
    label(CW - 14, drop - 4, "responder: fell ≥" + r.responseDrop + "%", { size: FS.small, fill: p.muted, anchor: "end" }));
  if (r.fromWeeks < 0) out.push(`<line x1="${r1(xs(0))}" y1="${T}" x2="${r1(xs(0))}" y2="${T + PH}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-dasharray="2 2"/>`);
  r.panels.forEach((pn, i) => {
    const st = seriesStyle(i);
    const pts = pn.course.filter((c) => c.median != null && c.n >= LAB_MIN_POINT_N);
    if (!pts.length) return;
    const mid = (c: typeof pts[number]) => r1(xs(c.week + r.binWeeks / 2));
    const band = "M" + pts.map((c) => mid(c) + " " + r1(clampY(c.q3!))).join("L") + "L" + [...pts].reverse().map((c) => mid(c) + " " + r1(clampY(c.q1!))).join("L") + "Z";
    out.push(`<path d="${band}" fill="${st.color}" opacity="${r1(15 * st.tint) / 100}"/>`);
    out.push(`<path d="M${pts.map((c) => mid(c) + " " + r1(clampY(c.median!))).join("L")}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + `/>`);
    for (const c of pts) out.push(`<circle cx="${mid(c)}" cy="${r1(clampY(c.median!))}" r="2.5" fill="${st.color}"/>`);
  });
  const courseBottom = T + PH + bottomAxisHeight(xTitle);

  // waterfall of best response per cohort (a histogram of it when values were withheld), each with its own scale
  const WX0 = side ? CW + 24 : 0, WR = W - 12;
  let wy = side ? 0 : courseBottom + 16;
  out.push(label(WX0 + 8, wy + 14, "Best % change after the start, worst to best", { size: FS.title, fill: p.ink, weight: 600, maxW: WR - WX0 - 8 }));
  wy += T;
  const wys = linear(-100, 100, WATERFALL_H, 0, { nice: false });
  wys.ticks = [-100, -50, 0, 50, 100];
  const wFmt = signed(wys.fmt);
  const wTitle = "best % change";
  const WX = WX0 + 8 + leftAxisWidth(wys, wTitle, wFmt);
  r.panels.forEach((pn, i) => {
    const st = seriesStyle(i);
    const rate = pn.evaluable ? fmtPct(100 * pn.responders / pn.evaluable) : "—";
    const stat = rate + " fell ≥" + r.responseDrop + "% (" + fmtInt(pn.responders) + "/" + fmtInt(pn.evaluable) + ")";
    const statW = textWidth(stat, FS.body), nameW = textWidth(pn.cohort, FS.body, 600), room = WR - WX;
    out.push(label(WX, wy + FS.body, pn.cohort, { size: FS.body, fill: st.color, weight: 600, maxW: nameW + 8 + statW <= room ? undefined : room }));
    if (nameW + 8 + statW <= room) out.push(label(WX + nameW + 8, wy + FS.body, stat, { size: FS.body, fill: p.ink }));
    else { wy += FS.body + 4; out.push(label(WX, wy + FS.body, stat, { size: FS.body, fill: p.ink, maxW: room })); }
    const top = wy + FS.body + 8;
    const sy = linear(-100, 100, top + WATERFALL_H, top, { nice: false });
    sy.ticks = wys.ticks;
    const s = (val: number) => sy(Math.max(-100, Math.min(100, val)));
    if (pn.waterfall && pn.waterfall.length) {
      out.push(axisLeft(sy, WX, p, { title: i === 0 || r.panels.length < 3 ? wTitle : undefined, gridTo: WR, fmt: wFmt }));
      const vals = [...pn.waterfall].sort((a, b) => b - a), bw = (WR - WX) / vals.length, y0 = s(0);
      let d = "";
      vals.forEach((val, k) => {
        const y1 = s(val);
        d += `M${r1(WX + k * bw)} ${r1(Math.min(y0, y1))}h${r1(Math.max(bw, 0.5))}v${r1(Math.max(0.5, Math.abs(y1 - y0)))}h${r1(-Math.max(bw, 0.5))}z`;
      });
      out.push(`<path d="${d}" fill="${st.color}" opacity="${r1(85 * st.tint) / 100}"/>`);
      out.push(`<line x1="${WX}" y1="${r1(y0)}" x2="${WR}" y2="${r1(y0)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
      out.push(`<line x1="${WX}" y1="${r1(s(-r.responseDrop))}" x2="${WR}" y2="${r1(s(-r.responseDrop))}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
      wy = top + WATERFALL_H + 4;
      out.push(label(WX, wy + FS.small, "patients, worst to best: " + fmtInt(vals.length) + (pn.waterfallCapped ? " drawn, " + fmtInt(pn.waterfallCapped) + " more past the bar limit" : ""), { size: FS.small, fill: p.muted, maxW: room }));
      wy += FS.small + 14;
    } else {
      // the 2-point bins of best % change, −100 to +300 (the last holds everything above)
      const max = Math.max(1, ...pn.best);
      const hy = linear(0, max, top + WATERFALL_H, top, { count: 3 });
      const hxL = WX0 + 8 + leftAxisWidth(hy, "patients");
      const hx = linear(-101, 301, hxL, WR, { nice: false });
      hx.ticks = [-100, -50, 0, 50, 100, 200, 300];
      out.push(axisLeft(hy, hxL, p, { title: "patients", gridTo: WR }));
      const bw = (WR - hxL) / pn.best.length;
      let d = "";
      pn.best.forEach((c, k) => { if (c) { const h = top + WATERFALL_H - hy(c); d += `M${r1(hxL + k * bw)} ${r1(top + WATERFALL_H)}v${r1(-h)}h${r1(Math.max(bw, 0.5))}v${r1(h)}z`; } });
      out.push(`<path d="${d}" fill="${st.color}" opacity="${r1(80 * st.tint) / 100}"/>`);
      const dx = r1(hx(-r.responseDrop));
      out.push(`<line x1="${dx}" y1="${top}" x2="${dx}" y2="${top + WATERFALL_H}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
      const hTitle = "histogram, −100 → +300%" + (pn.waterfallWithheld ? " (" + fmtInt(pn.waterfallWithheld) + " patients' values withheld)" : "");
      out.push(axisBottom(hx, top + WATERFALL_H, p, { title: hTitle, minX: WX0, maxX: W, fmt: signed(hx.fmt) }));
      wy = top + WATERFALL_H + bottomAxisHeight(hTitle) + 10;
    }
  });

  let yy = Math.max(side ? courseBottom : 0, wy) + 10;
  r.panels.forEach((pn, i) => {
    const st = seriesStyle(i);
    out.push(`<rect x="8" y="${yy + 2}" width="10" height="10" rx="2" fill="${st.color}" opacity="${st.tint}"/>`);
    const para = paragraph(pn.cohort + " · " + fmtInt(pn.anchored) + " started, " + fmtInt(pn.baseline) + " with a baseline, " +
      fmtInt(pn.evaluable) + " measured after", 24, yy - 2, W - 32, p.ink);
    out.push(para.svg);
    yy += para.height;
  });
  if (r.responseP != null) {
    const para = paragraph("response rates differ: Fisher " + fmtP(r.responseP), 8, yy - 2, W - 16, p.ink);
    out.push(para.svg);
    yy += para.height;
  }
  const cap = caption(v.caveat || "", W, yy, p.muted);
  return frame(W, yy + cap.height + 8, out.join("") + cap.svg, p.bg, false,
    "Lab course — " + r.test + " from " + r.anchoredTo + " — " + r.panels.map((pn) => pn.cohort).join(", "));
}
