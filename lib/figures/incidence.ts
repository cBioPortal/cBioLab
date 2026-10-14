// Incidence figure: cumulative incidence curves, with death as a competing risk, and the
// estimates at each horizon set beside what 1 − KM would claim.
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend, label, textWidth,
  seriesStyle, fmtInt, fmtNum, fmtPct, fmtCI, fmtP, pDigits, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { Z_975 } from "../stats.ts";
import { stepPath } from "../chart/marks.ts";
import { plotHeight } from "./survival.ts";
import { timeScale, timeTitle, paragraph, lineSwatch, r1 } from "./time-axis.ts";

/** the competing event's line: thin and dotted, so it never reads as a seventh cohort's dashed one */
const COMPETING_DASH = "2 2.5";
const SWATCH = 18, GAP = 16;

export function incidenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.incidence!;
  // every cohort keeps its series index (and so the colour its page swatch has); one no patient could
  // be at risk in is not drawn, and its counts line says so
  const curves = r.curves;
  const drawn = (c: (typeof curves)[number]) => c.points.length > 0 || c.n > 0;
  const tLast = Math.max(12, ...curves.map((c) => c.points.length ? c.points[c.points.length - 1].t : 0));
  const tMax = Math.min(tLast, Math.max(...r.horizons.map((h) => h.months)) * 1.25);

  // the horizon table: one row per cohort, one column per horizon; each cell the estimate and its
  // interval, with 1 − KM beside it (or under it, when the columns do not fit side by side)
  const est = (c: { f1: number; lo: number; hi: number }) => fmtPct(c.f1 * 100) + " " + fmtCI(c.lo * 100, c.hi * 100, (x) => fmtPct(x));
  const naive = (c: { naive: number }) => "1−KM " + fmtPct(c.naive * 100);
  const cells = r.horizons.flatMap((h) => h.cells);
  const head = (m: number) => fmtNum(m) + " months";
  const estW = Math.max(...r.horizons.map((h) => textWidth(head(h.months), FS.small)), ...cells.map((c) => textWidth(est(c), FS.body)));
  const naiveW = Math.max(0, ...cells.map((c) => textWidth(naive(c), FS.small)));
  const nameText = Math.max(textWidth("incidence by", FS.small), ...curves.map((c) => textWidth(c.cohort, FS.body)));
  const nh = Math.max(1, r.horizons.length);
  const needs = (nameW: number, cellW: number) => 8 + nameW + nh * (GAP + cellW) + 8;
  let W = Math.max(420, o.width || 760), grown = false;
  const nameW = SWATCH + 6 + Math.min(nameText, Math.max(140, W * 0.3));
  const wide = needs(nameW, estW + 6 + naiveW) <= W;
  if (!wide && needs(nameW, Math.max(estW, naiveW)) > W) { W = Math.ceil(needs(nameW, Math.max(estW, naiveW))); grown = true; }
  const cellW = wide ? estW + 6 + naiveW : Math.max(estW, naiveW);

  // the plot
  const T = 12, R = 16, PLOT = plotHeight(W);
  const peak = Math.max(0.05, ...curves.flatMap((c) => c.points.filter((q) => q.t <= tMax).map((q) => Math.max(q.f1 + Z_975 * q.se1, q.f2))));
  let ys = linear(0, Math.min(1, peak) * 100, T + PLOT, T);
  if (ys.domain[1] > 100) { ys = linear(0, 100, T + PLOT, T, { nice: false }); ys.ticks = [0, 25, 50, 75, 100]; }
  const yFmt = (t: number) => ys.fmt(t) + "%";
  const yTitle = "Cumulative incidence";
  const L = 8 + leftAxisWidth(ys, yTitle, yFmt);
  const xs = timeScale(0, tMax, L, W - R);
  const xTitle = timeTitle("Months", r.anchoredTo || "the study's day 0");
  const y = (f: number) => ys(Math.min(1, Math.max(0, f)) * 100);
  const out: string[] = [];
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R, fmt: yFmt }));
  out.push(axisBottom(xs, T + PLOT, p, { title: xTitle, minX: 0, maxX: W }));
  curves.forEach((c, i) => {
    if (!drawn(c)) return;
    const st = seriesStyle(i);
    const pts = c.points.filter((q) => q.t <= tMax);
    if (pts.length) {
      const up = stepVertices(pts.map((q) => ({ t: q.t, s: Math.min(1, q.f1 + Z_975 * q.se1) })), xs, y, tMax);
      const lo = stepVertices(pts.map((q) => ({ t: q.t, s: Math.max(0, q.f1 - Z_975 * q.se1) })), xs, y, tMax);
      out.push(`<path d="${hvPath([...up, ...lo.reverse()])}Z" fill="${st.color}" opacity="${r1(0.13 * st.tint * 100) / 100}"/>`);
    }
    const line = (key: "f1" | "f2") => stepPath(pts.map((q) => ({ t: q.t, s: q[key] })), xs, y, { t: 0, s: 0 }, tMax);
    out.push(`<path d="${line("f2")}" fill="none" stroke="${st.color}" stroke-width="${SW.line}" stroke-dasharray="${COMPETING_DASH}" opacity="0.85"/>`);
    out.push(`<path d="${line("f1")}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
  });

  // how to read the lines
  let yy = T + PLOT + bottomAxisHeight(xTitle) + 8;
  const key = legend([
    { label: r.eventLabel, color: p.ink, kind: "line" },
    { label: "death without it (competing)", color: p.ink, kind: "line", dash: COMPETING_DASH },
    { label: "95% interval", color: p.ink, opacity: 0.18 }
  ], 8, yy, W - 16, p, { size: FS.small });
  out.push(key.svg);
  yy += key.height + 6;

  // the horizon table
  const ROW = wide ? 20 : 32;
  const colX = (k: number) => 8 + nameW + GAP + k * (cellW + GAP);
  out.push(label(8, yy + FS.small, "incidence by", { size: FS.small, fill: p.muted }));
  r.horizons.forEach((h, k) => out.push(label(colX(k), yy + FS.small, head(h.months), { size: FS.small, fill: p.muted })));
  yy += FS.small + 6;
  let row = 0;
  curves.forEach((c, i) => {
    if (!drawn(c)) return;
    const st = seriesStyle(i), base = yy + (wide ? ROW / 2 + FS.body * 0.35 : FS.body + 4);
    if (row++ % 2 === 0) out.push(`<rect x="4" y="${yy}" width="${r1(Math.min(W - 8, colX(nh - 1) + cellW))}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
    out.push(lineSwatch(8, base - FS.body * 0.35, st.color, st.dash));
    out.push(label(8 + SWATCH + 6, base, c.cohort, { size: FS.body, fill: p.ink, maxW: nameW - SWATCH - 6 }));
    r.horizons.forEach((h, k) => {
      const cell = h.cells.find((x) => x.cohort === c.cohort);
      if (!cell) { out.push(label(colX(k), base, "–", { size: FS.body, fill: p.muted })); return; }
      out.push(label(colX(k), base, est(cell), { size: FS.body, fill: p.ink }));
      out.push(wide
        ? label(colX(k) + estW + 6, base, naive(cell), { size: FS.small, fill: p.muted })
        : label(colX(k), base + FS.small + 3, naive(cell), { size: FS.small, fill: p.muted }));
    });
    yy += ROW;
  });
  yy += 8;

  // who was counted, and who could not be at risk
  curves.forEach((c, i) => {
    const st = seriesStyle(i);
    const x = c.excluded;
    const text = c.cohort + " — n = " + fmtInt(c.n) + ": " + fmtInt(c.events) + " events, " + fmtInt(c.competing) + " died first, " +
      fmtInt(c.censored) + " censored · not at risk: " + fmtInt(x.prior) + " already had it" +
      (x.unobserved ? ", " + fmtInt(x.unobserved) + " before observation" : "") +
      (x.noAnchor ? ", " + fmtInt(x.noAnchor) + " no anchor event" : "") + (x.noFollowup ? ", " + fmtInt(x.noFollowup) + " no follow-up" : "") +
      (drawn(c) ? "" : " — not drawn: no patient could be at risk");
    out.push(lineSwatch(8, yy + FS.small * 0.65, st.color, st.dash));
    const para = paragraph(text, 8 + SWATCH + 6, yy - 2, W - 16 - SWATCH - 6, p.muted, { size: FS.small });
    out.push(para.svg);
    yy += para.height;
  });
  if (r.gray) {
    yy += 4;
    const g = r.gray, floor = g.p <= 1 / (g.permutations + 1) + 1e-12;
    const para = paragraph("Gray's test across " + g.groups + " cohorts: statistic " + fmtNum(g.statistic) + ", permutation " +
      (floor ? "p ≤ " + pDigits(g.p) + " (no shuffle of " + fmtInt(g.permutations) + " as extreme)" : fmtP(g.p) + " (" + fmtInt(g.permutations) + " shuffles)"),
      8, yy - 2, W - 16, p.ink);
    out.push(para.svg);
    yy += para.height;
  }
  const cap = caption(v.caveat || "", W, yy, p.muted);
  return frame(W, yy + cap.height + 8, out.join("") + cap.svg, p.bg, grown,
    "Cumulative incidence of " + r.eventLabel + " — " + curves.map((c) => c.cohort).join(", "));
}

/**
 * The corners of a step function from (0, 0) to tEnd, merging steps in one pixel column as
 * stepPath does, so a band drawn from them lines up with the curve drawn by it.
 */
function stepVertices(points: { t: number; s: number }[], x: (t: number) => number, y: (s: number) => number, tEnd: number): [number, number][] {
  const v: [number, number][] = [[x(0), y(0)]];
  let level = y(0), lastX = x(0);
  for (const q of points) {
    const nx = x(q.t), ny = y(q.s);
    if (nx - lastX < 0.5 && v.length > 1) v[v.length - 1][1] = ny;
    else { v.push([nx, level], [nx, ny]); lastX = nx; }
    level = ny;
  }
  v.push([Math.max(lastX, x(tEnd)), level]);
  return v;
}

/** a polyline of horizontal and vertical moves, written as H / V where it can be */
function hvPath(v: [number, number][]): string {
  let d = "M" + r1(v[0][0]) + " " + r1(v[0][1]);
  for (let i = 1; i < v.length; i++) {
    const [x0, y0] = v[i - 1], [x, y] = v[i];
    if (r1(x) === r1(x0) && r1(y) === r1(y0)) continue;
    d += r1(y) === r1(y0) ? "H" + r1(x) : r1(x) === r1(x0) ? "V" + r1(y) : "L" + r1(x) + " " + r1(y);
  }
  return d;
}
