// Cut-point figure: the scan's statistic against each candidate cut (the chosen one marked, the
// permutation 95% line dashed), the two groups' Kaplan–Meier curves at it, and per-stratum cuts.
import type { DrawnResultOf } from "../types.ts";
import {
  palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, label, textWidth,
  fmtInt, fmtNum, fmtP, fmtRatio, fmtMonths, paragraph, SERIES, FS, SW, r1, type SvgOpts
} from "../svg-kit.ts";
import { kmPanel } from "./km.ts";

const medianText = (m: number | null) => m == null ? "not reached" : fmtMonths(m);

export function cutpointSvg(v: DrawnResultOf<"cutpoint">, o: SvgOpts): string {
  const m = v.cutpoint, p = palette(o.theme);
  let W = Math.max(480, o.width || 720), grown = false;
  const out: string[] = [];
  // the scan
  out.push(label(8, FS.title + 2, "Log-rank statistic at each candidate cut of " + m.attribute, { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  const T = FS.title + 16, PH = Math.round(Math.max(150, Math.min(220, W * 0.22)));
  const cs = m.candidates;
  const yMax = Math.max(m.maxStat, m.critical95 || 0, 1) * 1.1;
  const ys = linear(0, yMax, T + PH, T);
  const yTitle = "χ² (standardized)";
  const L = 8 + leftAxisWidth(ys, yTitle), R = W - 16;
  const x0 = cs[0].cut, x1 = cs[cs.length - 1].cut;
  const xs = linear(x0, x1 > x0 ? x1 : x0 + 1, L, R);
  const xTitle = m.attribute + " cut (high is above it)";
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R }));
  out.push(axisBottom(xs, T + PH, p, { title: xTitle, minX: 0, maxX: W }));
  out.push(`<path d="${cs.map((c, i) => (i ? "L" : "M") + r1(xs(c.cut)) + " " + r1(ys(c.stat))).join("")}" fill="none" stroke="${SERIES[0]}" stroke-width="${SW.series}" stroke-linejoin="round"/>`);
  if (Number.isFinite(m.critical95)) {
    const cy = r1(ys(m.critical95));
    out.push(`<line x1="${L}" y1="${cy}" x2="${R}" y2="${cy}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="4 3"/>`);
    const t = "permutation 95%: " + fmtNum(m.critical95);
    out.push(label(R - 4, cy - 4, t, { size: FS.small, fill: p.muted, anchor: "end" }));
  }
  const bx = r1(xs(m.cut)), by = r1(ys(m.maxStat));
  out.push(`<circle cx="${bx}" cy="${by}" r="4.5" fill="${SERIES[4]}" stroke="${p.bg}" stroke-width="1"/>`);
  const tag = "cut " + fmtNum(m.cut) + " · χ² " + fmtNum(m.maxStat);
  const tw = textWidth(tag, FS.small);
  out.push(label(Math.min(R - tw, Math.max(L + 2, bx + 8)), Math.max(T + FS.small, by - 8), tag, { size: FS.small, fill: p.ink,
    extra: `stroke="${p.bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` }));
  let y = T + PH + bottomAxisHeight(xTitle) + 8;
  const lines = ["best cut " + m.attribute + " > " + fmtNum(m.cut) + " (" + fmtInt(m.high.n) + " high, " + fmtInt(m.low.n) + " low): permutation-corrected " + fmtP(m.permP) +
    " (" + fmtInt(m.permutations) + " permutations, seed " + m.seed + ") · naive log-rank " + fmtP(m.naiveP) + " — the naive p ignores the search",
  m.hr ? "high vs low HR " + fmtRatio(m.hr.hr) + " [95% CI " + fmtRatio(m.hr.ciLow) + "–" + fmtRatio(m.hr.ciHigh) + "]" : ""].filter(Boolean);
  for (const s of lines) { const para = paragraph(s, 8, y, W - 16, p.ink); out.push(para.svg); y += para.height; }
  y += 10;
  // the curves at the cut
  const km = kmPanel([
    { name: "low (≤ " + fmtNum(m.cut) + ")", points: m.curves.low.points, atRisk: m.curves.low.atRisk, detail: "median " + medianText(m.low.median) + " · n = " + fmtInt(m.low.n) + " · " + fmtInt(m.low.events) + " events" },
    { name: "high (> " + fmtNum(m.cut) + ")", points: m.curves.high.points, atRisk: m.curves.high.atRisk, detail: "median " + medianText(m.high.median) + " · n = " + fmtInt(m.high.n) + " · " + fmtInt(m.high.events) + " events" },
  ], { y0: y, W, p, xTitle: "Months (" + m.endpoint + ")", yTitle: "Survival probability", title: m.endpoint + " by the chosen cut" });
  out.push(km.svg);
  y += km.height + 8;
  // per stratum
  if (m.strata && m.strata.rows.length) {
    out.push(label(8, y + FS.title, "A cut per " + m.strata.attribute, { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
    y += FS.title + 10;
    const heads = [m.strata.attribute, "n · events", "cut", "high", "HR [95% CI]", "corrected p", "naive p"];
    const rows = m.strata.rows.map((s) => [s.stratum, fmtInt(s.n) + " · " + fmtInt(s.events), fmtNum(s.cut), fmtInt(s.high.n),
      s.hr ? fmtRatio(s.hr.hr) + " [" + fmtRatio(s.hr.ciLow) + "–" + fmtRatio(s.hr.ciHigh) + "]" : "—", fmtP(s.permP), fmtP(s.naiveP)]);
    const colW = heads.map((h, k) => Math.max(textWidth(h, FS.small), ...rows.map((r) => textWidth(r[k], FS.body))));
    const CG = 16, nameW = Math.min(colW[0], Math.max(120, W * 0.3));
    const need = 8 + nameW + colW.slice(1).reduce((a, w) => a + w + CG, 0) + CG + 8;
    if (need > W) { W = Math.ceil(need); grown = true; }
    const xOf = [8];
    for (let k = 1; k < heads.length; k++) xOf.push(xOf[k - 1] + (k === 1 ? nameW : colW[k - 1]) + CG);
    heads.forEach((h, k) => out.push(label(xOf[k], y + FS.small, h, { size: FS.small, fill: p.muted })));
    y += FS.small + 4;
    const ROW = 20;
    rows.forEach((r, i) => {
      if (i % 2 === 0) out.push(`<rect x="4" y="${y}" width="${r1(Math.min(W - 8, need))}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
      const base = y + ROW / 2 + FS.body * 0.35, sig = m.strata!.rows[i].permP < 0.05;
      r.forEach((c, k) => out.push(label(xOf[k], base, c, { size: FS.body, fill: p.ink, maxW: k === 0 ? nameW : undefined, weight: k === 5 && sig ? 600 : 400 })));
      y += ROW;
    });
    y += 6;
  }
  const text = fmtInt(m.n) + " patients with a value, " + fmtInt(m.events) + " events; " + fmtInt(m.noValue) + " with a survival time but no value." +
    (m.strata ? " " + m.strata.omitted.values + " " + m.strata.attribute + " values (" + fmtInt(m.strata.omitted.patients) + " patients) not scanned." : "") + " " + (v.caveat || "");
  const cap = caption(text, W, y + 4, p.muted);
  return frame(W, y + 4 + cap.height + 8, out.join("") + cap.svg, p.bg, grown, "Cut-point — " + m.attribute + " on " + m.endpoint);
}
