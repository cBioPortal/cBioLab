// A forest plot: one row per covariate (or level), its ratio and 95% CI on a log axis, with the
// numbers in a column beside it. Cox (hazard ratios) and logistic (odds ratios) share it.
//
// Panels (one per cohort, when stratified) share ONE ratio scale, so effect sizes compare at a
// glance. The scale is set by the estimates, not by the widest interval: a covariate that barely
// converged can have an upper bound in the millions, which would otherwise squash every other row
// to a dot. An interval running past the scale ends in an arrow, and the caption says so.
import type { DrawnResultOf } from "../types.ts";
import {
  palette, frame, caption, log, axisBottom, bottomAxisHeight, label, textWidth,
  fmtRatio, pDigits, FS, SW, SERIES, type SvgOpts
} from "../svg-kit.ts";

interface Coef { label: string; reference?: string; ciLow: number; ciHigh: number; ratio: number; p: number }
interface Panel { heading: string | null; coefs: Coef[] }

const ROW = 22, HEAD = 24, GAP = 14;

function forestSvg(panels: Panel[], W: number, theme: SvgOpts["theme"], ratioName: string, note: string, title: string): string {
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

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Cox: hazard ratios; with stratifyByCohort, one panel per cohort that fit */
export function coxSvg(v: DrawnResultOf<"cox">, o: SvgOpts): string {
  const byCohort = v.cox?.byCohort;
  const panels: Panel[] = byCohort
    ? byCohort.filter((c) => c.coefficients.length).map((c) => ({
        heading: c.cohort + " — n = " + c.n.toLocaleString("en-US") + ", " + c.events.toLocaleString("en-US") + " events",
        coefs: c.coefficients.map((cf) => ({ ...cf, ratio: cf.hr })) }))
    : [{ heading: null, coefs: (v.cox?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.hr })) }];
  return forestSvg(panels, Math.max(520, o.width || 760), o.theme, "HR", v.caveat || "", "Cox regression — hazard ratios");
}

/** logistic: odds ratios, one panel */
export function logisticSvg(v: DrawnResultOf<"logistic">, o: SvgOpts): string {
  const panels: Panel[] = [{ heading: null, coefs: (v.logistic?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.or })) }];
  return forestSvg(panels, Math.max(520, o.width || 760), o.theme, "OR", v.caveat || "", "Logistic regression — odds ratios");
}
