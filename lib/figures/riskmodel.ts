// Risk model figure: the risk groups' survival curves and the genes the model kept.
import {
  palette, frame, caption, linear, log, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, label, textWidth,
  seriesStyle, SERIES, fmtInt, fmtNum, fmtPct, fmtShare, fmtRatio, fmtP, fmtMonths, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { stepPath } from "../chart/marks.ts";
import { plotHeight } from "./survival.ts";
import { timeScale, timeTitle } from "../chart/time.ts";
import { paragraph } from "../chart/text.ts";
import { lineSwatch } from "../chart/legend.ts";
import { r1 } from "../chart/marks.ts";

/** a hazard ratio below 1 and above it take the shared series' blue and vermillion */
const FAVOURABLE = SERIES[0], ADVERSE = SERIES[4];

/** How many of the model's genes the figure lists; the rest are in the result and said in the caption. */
export const RISK_FIGURE_GENES = 15;

/** the gene chart reads as one unit: past this its bars would sit far from their names */
const GENE_BARS_MAX = 420;

/**
 * The risk model: Kaplan–Meier curves of the risk groups, then the genes the model kept most
 * often with their mean hazard ratio (a bar on a log scale about 1), then what the numbers rest on.
 */
export function riskmodelSvg(v: ViewResult, o: SvgOpts): string {
  const m = v.riskmodel!;
  const p = palette(o.theme);
  let W = Math.max(480, o.width || 720), grown = false;

  // the group table's columns, measured
  const pc = (x: number | null) => x == null ? "—" : fmtShare(x, 0);
  const rows = m.groups.map((g, i) => [g.name, fmtInt(g.curve.n) + " · " + fmtInt(g.curve.events),
    g.curve.median == null ? "not reached" : fmtMonths(g.curve.median), pc(g.at12), pc(g.at36),
    g.hr == null ? (i === 0 ? "reference" : "—") : fmtRatio(g.hr) + " [" + fmtRatio(g.ciLow!) + "–" + fmtRatio(g.ciHigh!) + "]",
    g.p == null ? "" : fmtP(g.p)]);
  const heads = ["group", "patients · events", "median", "12 mo", "36 mo", "HR vs lowest [95% CI]", ""];
  const colW = heads.map((h, k) => Math.max(textWidth(h, FS.small), ...rows.map((r) => textWidth(r[k], FS.body))));
  const SW_X = 8, TX = SW_X + 18 + 6, CG = 18;
  const tableW = (nameW: number) => TX + nameW + colW.slice(1).reduce((a, w) => a + w + CG, 0) + 8;
  const nameW = Math.min(colW[0], Math.max(90, W * 0.25));
  if (tableW(nameW) > W) { W = Math.ceil(tableW(nameW)); grown = true; }

  // the curves
  const T = 12, R = 16, PLOT = plotHeight(W);
  const curves = m.groups.map((g) => g.curve);
  const tMax = Math.max(1, ...curves.flatMap((c) => c.points.map((q) => q.t)));
  const ys = linear(0, 1, T + PLOT, T, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const yFmt = (t: number) => fmtShare(t, 0);
  const yTitle = "Survival probability";
  const L = 8 + leftAxisWidth(ys, yTitle, yFmt);
  const xs = timeScale(0, tMax, L, W - R);
  const xTitle = timeTitle("Months", m.anchoredTo);
  const out: string[] = [];
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R, fmt: yFmt }));
  out.push(axisBottom(xs, T + PLOT, p, { title: xTitle, minX: 0, maxX: W }));
  curves.forEach((c, i) => {
    const st = seriesStyle(i);
    out.push(`<path d="${stepPath(c.points, xs, ys, { t: 0, s: 1 }, tMax)}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
  });
  let yy = T + PLOT + bottomAxisHeight(xTitle) + 10;

  // one row per group: size, median, survival at 12 and 36 months, hazard ratio against the lowest group
  const xOf: number[] = [TX];
  for (let k = 1; k < heads.length; k++) xOf.push(xOf[k - 1] + (k === 1 ? nameW : colW[k - 1]) + CG);
  heads.forEach((h, k) => h && out.push(label(xOf[k], yy + FS.small, h, { size: FS.small, fill: p.muted })));
  yy += FS.small + 4;
  const ROW = 20;
  rows.forEach((r, i) => {
    const st = seriesStyle(i), base = yy + ROW / 2 + FS.body * 0.35;
    if (i % 2 === 0) out.push(`<rect x="4" y="${yy}" width="${r1(Math.min(W - 8, tableW(nameW)))}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
    out.push(lineSwatch(SW_X, yy + ROW / 2, st.color, st.dash));
    r.forEach((c, k) => c && out.push(label(xOf[k], base, c, { size: FS.body, fill: p.ink, maxW: k === 0 ? nameW : undefined })));
    yy += ROW;
  });
  yy += 6;

  // the tests and fits, each its own wrapped line
  const stats: string[] = [];
  if (m.logrank) stats.push("log-rank χ² = " + fmtNum(m.logrank.chi2) + " (" + m.logrank.df + " df) · " + fmtP(m.logrank.p) +
    (m.logrank.strata > 1 ? " · stratified by " + (m.strata || "") + ", " + m.logrank.strata + " strata" : ""));
  if (m.refit) stats.push("risk score alone: HR " + fmtRatio(m.refit.hr) + " per standard deviation [95% CI " + fmtRatio(m.refit.ciLow) + "–" +
    fmtRatio(m.refit.ciHigh) + "] · " + fmtP(m.refit.p));
  stats.push("held-out C-index " + m.cIndex.median.toFixed(3) + " (IQR " + m.cIndex.q1.toFixed(3) + "–" + m.cIndex.q3.toFixed(3) + ") over " + m.runs + " runs" +
    (m.validation ? " · on the validation half: " + m.validation.cIndex.toFixed(3) + " (" + fmtInt(m.validation.validation) + " patients never trained on)" : ""));
  if (m.covariates.length) stats.push("adjusted for (always in the model): " + m.covariates.map((c) => c.name + " HR " + fmtRatio(c.hr)).join(" · "));
  for (const s of stats) {
    const para = paragraph(s, 8, yy - 2, W - 16, p.ink);
    out.push(para.svg);
    yy += para.height;
  }

  // the distribution of the score the groups are cut from, with the cuts
  yy += 14;
  out.push(label(8, yy, "Risk score (" + m.reportedOn + "), with the group cuts", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  yy += 10;
  const ex = m.histogram.edges, HH = 64;
  const hy = linear(0, Math.max(1, ...m.histogram.counts), yy + HH, yy, { count: 2 });
  const hL = 8 + leftAxisWidth(hy, "patients");
  const hx = linear(ex[0], ex[ex.length - 1], hL, W - R, { nice: false });
  out.push(axisLeft(hy, hL, p, { title: "patients", gridTo: W - R }));
  let bars = "";
  m.histogram.counts.forEach((c, k) => {
    const x0 = hx(ex[k]), x1 = hx(ex[k + 1]), top = hy(c);
    if (c) bars += `M${r1(x0 + 0.5)} ${r1(yy + HH)}V${r1(top)}H${r1(Math.max(x0 + 1, x1 - 0.5))}V${r1(yy + HH)}Z`;
  });
  out.push(`<path d="${bars}" fill="${p.muted}" opacity="0.55"/>`);
  m.groups.slice(1).forEach((g) => {
    if (g.from == null) return;
    const x = r1(hx(g.from));
    out.push(`<line x1="${x}" y1="${yy - 2}" x2="${x}" y2="${yy + HH}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-dasharray="3 2"/>`);
  });
  const hTitle = "risk score — lower risk ← → higher risk";
  out.push(axisBottom(hx, yy + HH, p, { title: hTitle, minX: 0, maxX: W }));
  yy += HH + bottomAxisHeight(hTitle) + 18;

  // genes kept most often: selection share, and the mean hazard ratio as a bar about HR = 1 on a log scale
  const shown = m.features.slice(0, RISK_FIGURE_GENES);
  out.push(label(8, yy, "Genes kept most often (share of runs · mean hazard ratio where kept)", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  yy += 8;
  if (shown.length) {
    const detail = (f: typeof shown[number]) => fmtPct(f.selected * 100, 0) + " · " + fmtInt(f.mutated) + " mutated";
    const labW = Math.min(W * 0.4, Math.max(...shown.map((f) => textWidth(f.gene, FS.body, 600) + 6 + textWidth(detail(f), FS.small))));
    const hrW = Math.max(...shown.map((f) => textWidth("HR " + fmtRatio(f.hr), FS.body)));
    const bL = 8 + labW + 14;
    const bR = Math.min(W - 8 - hrW - 12, bL + GENE_BARS_MAX);
    const span = Math.max(2, ...shown.map((f) => Math.max(f.hr, 1 / f.hr))) * 1.05;
    const bx = log(1 / span, span, bL, bR, { nice: false });
    const ROWG = 18, top = yy;
    shown.forEach((f) => {
      const cy = yy + ROWG / 2, base = cy + FS.body * 0.35;
      out.push(label(8, base, f.gene, { size: FS.body, fill: p.ink, weight: 600, maxW: labW }));
      const gw = textWidth(f.gene, FS.body, 600) + 6;
      if (labW - gw > 24) out.push(label(8 + gw, base, detail(f), { size: FS.small, fill: p.muted, maxW: labW - gw }));
      const a = bx(1), b = bx(Math.min(span, Math.max(1 / span, f.hr)));
      out.push(`<rect x="${r1(Math.min(a, b))}" y="${r1(cy - 4)}" width="${r1(Math.max(1, Math.abs(b - a)))}" height="8" rx="2" fill="${f.hr < 1 ? FAVOURABLE : ADVERSE}" opacity="0.85"/>`);
      out.push(label(bR + 12, base, "HR " + fmtRatio(f.hr), { size: FS.body, fill: p.ink }));
      yy += ROWG;
    });
    out.push(`<line x1="${r1(bx(1))}" y1="${top}" x2="${r1(bx(1))}" y2="${yy}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
    const gTitle = "mean hazard ratio where kept (log scale)";
    out.push(axisBottom(bx, yy + 2, p, { title: gTitle, minX: bL - 20, maxX: bR + 20 }));
    yy += 2 + bottomAxisHeight(gTitle);
  }

  const left = [m.notProfiled ? fmtInt(m.notProfiled) + " with no mutation panel on record" : "", m.noStratum ? fmtInt(m.noStratum) + " with no " + m.strata : "",
    m.noCovariate ? fmtInt(m.noCovariate) + " missing a covariate" : "", m.noAnchor ? fmtInt(m.noAnchor) + " with no " + m.anchoredTo + " event" : "",
    m.anchorAfterStart ? fmtInt(m.anchorAfterStart) + " whose " + m.anchoredTo + " came after the study's day 0" : "",
    m.noFollowUp ? fmtInt(m.noFollowUp) + " with no follow-up after entry" : "",
    m.neverHeldOut ? fmtInt(m.neverHeldOut) + " never held out (so unscored and in no group)" : ""].filter(Boolean);
  const text = fmtInt(m.n) + " patients, " + fmtInt(m.events) + " events" + (m.anchoredTo ? ", clock from " + m.anchoredTo : "") +
    (m.validation ? " (trained on " + fmtInt(m.validation.discovery) + " in the discovery half, reported on " + fmtInt(m.validation.validation) + " in the validation half)" : "") +
    "; " + m.candidates + " candidate genes (of " + m.genesCovered + " covered for every patient, mutated in ≥" +
    m.minMutated + "); elastic net, alpha " + m.alpha + ", seed " + m.seed + "." + (left.length ? " Left out: " + left.join("; ") + "." : "") +
    (m.features.length > shown.length ? " " + (m.features.length - shown.length) + " more genes were kept in at least one run; they are in the result, not drawn." : "") +
    " " + (v.caveat || "");
  const cap = caption(text, W, yy + 4, p.muted);
  return frame(W, yy + 4 + cap.height + 8, out.join("") + cap.svg, p.bg, grown,
    "Risk model — " + m.groups.map((g) => g.name).join(", "));
}
