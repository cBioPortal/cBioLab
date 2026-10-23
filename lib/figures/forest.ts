// A forest plot: one row per covariate (or level), its ratio and 95% CI on a log axis, with the
// numbers in a column beside it. Cox (hazard ratios) and logistic (odds ratios) share it.
//
// Panels (one per cohort, when stratified) share ONE ratio scale, so effect sizes compare at a
// glance. The scale is set by the estimates, not by the widest interval: a covariate that barely
// converged can have an upper bound in the millions, which would otherwise squash every other row
// to a dot. An interval running past the scale ends in an arrow, and the caption says so.
import {
  palette, frame, caption, log, axisBottom, bottomAxisHeight, label, textWidth,
  fmtRatio, pDigits, FS, SW, SERIES, type SvgOpts
} from "../svg-kit.ts";

interface Coef { label: string; reference?: string; ciLow: number; ciHigh: number; ratio: number; p: number }
export interface Panel { heading: string | null; coefs: Coef[] }

export const ROW = 22, HEAD = 24, GAP = 14;

export function forestSvg(panels: Panel[], W: number, theme: SvgOpts["theme"], ratioName: string, note: string, title: string): string {
  const p = palette(theme);
  const all = panels.flatMap((pn) => pn.coefs);
  const rowLabel = (c: Coef) => c.label + (c.reference ? " vs " + c.reference : "");
  const value = (c: Coef) => fmtRatio(c.ratio) + " [" + fmtRatio(c.ciLow) + "–" + fmtRatio(c.ciHigh) + "]";

  // columns: labels | plot | ratio [CI] | p, each as wide as its widest entry (labels capped)
  const labW = Math.min(W * 0.34, Math.max(textWidth(ratioName, FS.small), ...all.map((c) => textWidth(rowLabel(c), FS.body)),
    ...panels.map((pn) => pn.heading ? textWidth(pn.heading, FS.body, 600) * 0.6 : 0)));
  const valW = Math.max(textWidth(ratioName + " [95% CI]", FS.small), ...all.map((c) => textWidth(value(c), FS.body)));
  const pW = Math.max(textWidth("p", FS.small), ...all.map((c) => textWidth(pDigits(c.p), FS.body)));
  const L = 8 + labW + 14, R = W - 8 - pW - 14 - valW - 14;

  // the scale: every estimate, 1, and the intervals as far as 4× past the estimates
  const est = all.map((c) => c.ratio).filter((r) => Number.isFinite(r) && r > 0);
  const eLo = Math.min(1, ...est), eHi = Math.max(1, ...est);
  const lims = [eLo / 4, eHi * 4];
  const ci = all.flatMap((c) => [c.ciLow, c.ciHigh]).filter((r) => Number.isFinite(r) && r > 0).map((r) => Math.min(lims[1], Math.max(lims[0], r)));
  const xs = log(Math.min(eLo, ...ci) * 0.9, Math.max(eHi, ...ci) * 1.1, L, R, { nice: false });
  const [d0, d1] = xs.domain;
  let offScale = 0;

  const out: string[] = [];
  // column heads
  out.push(label(R + 14, 14, ratioName + " [95% CI]", { size: FS.small, fill: p.muted }));
  out.push(label(W - 8, 14, "p", { size: FS.small, fill: p.muted, anchor: "end" }));
  let y = HEAD;
  const top = y;
  panels.forEach((pn, pi) => {
    if (pi) y += GAP;
    if (pn.heading) { out.push(label(8, y + 14, pn.heading, { size: FS.body, fill: p.ink, weight: 600, maxW: W - 16 })); y += ROW; }
    pn.coefs.forEach((c, i) => {
      const cy = y + ROW / 2;
      if (i % 2 === 0) out.push(`<rect x="4" y="${y}" width="${W - 8}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
      out.push(label(8, cy + FS.body * 0.35, rowLabel(c), { size: FS.body, fill: p.ink, maxW: labW }));
      const lo = Math.max(c.ciLow, d0), hi = Math.min(c.ciHigh, d1);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)
        out.push(`<line x1="${r1(xs(lo))}" y1="${cy}" x2="${r1(xs(hi))}" y2="${cy}" stroke="${SERIES[0]}" stroke-width="${SW.series}"/>`);
      for (const [past, at, dir] of [[c.ciLow < d0, xs(d0), -1], [c.ciHigh > d1, xs(d1), 1]] as [boolean, number, number][]) {
        if (!past) continue;
        offScale++;
        out.push(`<path d="M${r1(at)} ${cy} l${-dir * 6} -4 v8 Z" fill="${SERIES[0]}"/>`);
      }
      if (c.ratio > 0 && Number.isFinite(c.ratio))
        out.push(`<rect x="${r1(xs(Math.min(d1, Math.max(d0, c.ratio))) - 4)}" y="${cy - 4}" width="8" height="8" fill="${SERIES[0]}"/>`);
      out.push(label(R + 14, cy + FS.body * 0.35, value(c), { size: FS.body, fill: p.ink }));
      out.push(label(W - 8, cy + FS.body * 0.35, pDigits(c.p), { size: FS.body, fill: c.p < 0.05 ? p.ink : p.muted, anchor: "end", weight: c.p < 0.05 ? 600 : 400 }));
      y += ROW;
    });
  });
  // the line of no effect, through every panel, named once at its head
  out.push(`<line x1="${r1(xs(1))}" y1="${top - 4}" x2="${r1(xs(1))}" y2="${y}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
  out.push(label(xs(1), 14, ratioName + " = 1", { size: FS.small, fill: p.muted, anchor: "middle" }));
  const axTitle = ratioName + " (log scale) — left of 1 is lower, right is higher";
  out.push(axisBottom(xs, y + 4, p, { title: axTitle, minX: L - 20, maxX: R + 20 }));
  y += 4 + bottomAxisHeight(axTitle) + 6;
  const cap = caption(note + (offScale ? " " + offScale + " interval end" + (offScale === 1 ? " runs" : "s run") +
    " past the axis and " + (offScale === 1 ? "is" : "are") + " drawn as an arrow; the numbers beside it are exact." : ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, title);
}

export const r1 = (n: number) => Math.round(n * 10) / 10;

/** One row of a two-marker forest: a label, two ratios with their intervals (either may be missing), and a test's p (and q). */
export interface DualForestRow {
  label: string; detail?: string;
  a: { ratio: number; ciLow: number; ciHigh: number } | null;
  b: { ratio: number; ciLow: number; ciHigh: number } | null;
  p: number | null; q?: number | null;
  /** why the row has no estimates */
  note?: string;
}

/**
 * A forest with two markers per row — the same effect in two groups (a above b, each its own
 * series colour) on one log axis — and a test column on the right (p, and q where given), e.g. a
 * gene's hazard ratio among the treated and the untreated with the p of their interaction.
 */
export function dualForestSvg(rows: DualForestRow[], o: { width?: number; theme?: SvgOpts["theme"]; ratioName: string; names: [string, string];
  testName: string; note: string; title: string }): string {
  const W = Math.max(520, o.width || 760), p = palette(o.theme);
  const RR = 30, val = (e: DualForestRow["a"]) => e ? fmtRatio(e.ratio) + " [" + fmtRatio(e.ciLow) + "–" + fmtRatio(e.ciHigh) + "]" : "—";
  const pText = (r: DualForestRow) => r.p == null ? (r.note ? "" : "—") : pDigits(r.p) + (r.q != null ? " · q " + pDigits(r.q) : "");
  const labW = Math.min(W * 0.26, Math.max(textWidth(o.ratioName, FS.small), ...rows.map((r) => Math.max(textWidth(r.label, FS.body, 600), r.detail ? textWidth(r.detail, FS.small) : 0))));
  const valW = Math.max(...o.names.map((n) => textWidth(n, FS.small)), ...rows.flatMap((r) => [textWidth(val(r.a), FS.small), textWidth(val(r.b), FS.small)]));
  const pW = Math.max(textWidth(o.testName, FS.small), ...rows.map((r) => textWidth(pText(r), FS.body)));
  const L = 8 + labW + 14, R = W - 8 - pW - 14 - valW - 14;
  const ests = rows.flatMap((r) => [r.a, r.b]).filter((e): e is NonNullable<DualForestRow["a"]> => !!e && Number.isFinite(e.ratio) && e.ratio > 0);
  const eLo = Math.min(1, ...ests.map((e) => e.ratio)), eHi = Math.max(1, ...ests.map((e) => e.ratio));
  const lims = [eLo / 4, eHi * 4];
  const ci = ests.flatMap((e) => [e.ciLow, e.ciHigh]).filter((x) => Number.isFinite(x) && x > 0).map((x) => Math.min(lims[1], Math.max(lims[0], x)));
  const xs = log(Math.min(eLo, ...ci) * 0.9, Math.max(eHi, ...ci) * 1.1, L, R, { nice: false });
  const [d0, d1] = xs.domain;
  const out: string[] = [];
  // the two groups' key, then the column heads
  let kx = L;
  o.names.forEach((n, k) => {
    out.push(`<rect x="${r1(kx)}" y="5" width="8" height="8" fill="${SERIES[k === 0 ? 0 : 4]}"/>`);
    out.push(label(kx + 12, 13, n, { size: FS.small, fill: p.ink }));
    kx += 12 + textWidth(n, FS.small) + 24;
  });
  const HEAD = 34;
  out.push(label(R + 14, HEAD - 6, o.ratioName + " [95% CI]", { size: FS.small, fill: p.muted }));
  out.push(label(W - 8, HEAD - 6, o.testName, { size: FS.small, fill: p.muted, anchor: "end" }));
  let y = HEAD, offScale = 0;
  rows.forEach((r, i) => {
    if (i % 2 === 0) out.push(`<rect x="4" y="${y}" width="${W - 8}" height="${RR}" fill="${p.line}" opacity="0.35"/>`);
    out.push(label(8, y + 13, r.label, { size: FS.body, fill: p.ink, weight: 600, maxW: labW }));
    if (r.detail) out.push(label(8, y + 25, r.detail, { size: FS.small, fill: p.muted, maxW: labW }));
    if (r.note && !r.a && !r.b) out.push(label(L, y + RR / 2 + FS.small * 0.35, r.note, { size: FS.small, fill: p.muted, maxW: W - 8 - L }));
    ([r.a, r.b] as const).forEach((e, k) => {
      const cy = y + (k === 0 ? 10 : 21), col = SERIES[k === 0 ? 0 : 4];
      if (!e) return;
      const lo = Math.max(e.ciLow, d0), hi = Math.min(e.ciHigh, d1);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)
        out.push(`<line x1="${r1(xs(lo))}" y1="${cy}" x2="${r1(xs(hi))}" y2="${cy}" stroke="${col}" stroke-width="${SW.series}"/>`);
      for (const [past, at, dir] of [[e.ciLow < d0, xs(d0), -1], [e.ciHigh > d1, xs(d1), 1]] as [boolean, number, number][]) {
        if (!past) continue;
        offScale++;
        out.push(`<path d="M${r1(at)} ${cy} l${-dir * 6} -3.5 v7 Z" fill="${col}"/>`);
      }
      if (e.ratio > 0 && Number.isFinite(e.ratio)) out.push(`<rect x="${r1(xs(Math.min(d1, Math.max(d0, e.ratio))) - 3.5)}" y="${cy - 3.5}" width="7" height="7" fill="${col}"/>`);
      out.push(label(R + 14, cy + FS.small * 0.35, val(e), { size: FS.small, fill: p.ink }));
    });
    const sig = r.p != null && r.p < 0.05;
    out.push(label(W - 8, y + RR / 2 + FS.body * 0.35, pText(r), { size: FS.body, fill: sig ? p.ink : p.muted, anchor: "end", weight: sig ? 600 : 400 }));
    y += RR;
  });
  out.push(`<line x1="${r1(xs(1))}" y1="${HEAD - 2}" x2="${r1(xs(1))}" y2="${y}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
  const axTitle = o.ratioName + " (log scale) — left of 1 is lower, right is higher";
  out.push(axisBottom(xs, y + 4, p, { title: axTitle, minX: L - 20, maxX: R + 20 }));
  y += 4 + bottomAxisHeight(axTitle) + 6;
  const cap = caption(o.note + (offScale ? " " + offScale + " interval end" + (offScale === 1 ? " runs" : "s run") +
    " past the axis and " + (offScale === 1 ? "is" : "are") + " drawn as an arrow; the numbers beside it are exact." : ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, o.title);
}
