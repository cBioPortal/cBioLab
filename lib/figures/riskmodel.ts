// Risk model figure: the risk groups' survival curves and the genes the model kept.
import {
  palette, frame, caption, linear, log, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, label, textWidth,
  seriesStyle, SERIES, esc, fmtInt, fmtNum, fmtPct, fmtShare, fmtRatio, fmtP, fmtQ, fmtMonths, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import type { RiskTable1, ViewResultOf, DrawnResultOf } from "../types.ts";
import { stepPath } from "../chart/marks.ts";
import { plotHeight } from "./common.ts";
import { timeScale, timeTitle } from "../chart/time.ts";
import { paragraph } from "../chart/text.ts";
import { lineSwatch } from "../chart/legend.ts";
import { r1 } from "../chart/marks.ts";
import { placeLabels, type LabelWant } from "../chart/place.ts";
import { unplacedNote } from "./volcano.ts";

/** a hazard ratio below 1 and above it take the shared series' blue and vermillion */
const FAVOURABLE = SERIES[0], ADVERSE = SERIES[4];

/** the volcano names the genes kept in at least this share of runs, unless the view says otherwise */
export const RISK_LABEL_ABOVE = 0.5;

/** How many of the model's genes the figure lists; the rest are in the result and said in the caption. */
export const RISK_FIGURE_GENES = 15;

/** the gene chart reads as one unit: past this its bars would sit far from their names */
const GENE_BARS_MAX = 420;

type Risk = NonNullable<ViewResultOf<"riskmodel">["riskmodel"]>;

/** A raw score on OncoCast's 0–10 scale: 0 and 10 are the lowest and highest held-out scores the cuts are placed on. */
export function riskScaled(m: Pick<Risk, "scale">, raw: number): number {
  const span = m.scale.max - m.scale.min;
  return span > 0 ? (raw - m.scale.min) / span * 10 : 5;
}

/** a group's span of the 0–10 score, "3.1–5.4"; the open ends are the scale's own */
export function riskSpan(m: Risk, g: Risk["groups"][number]): string {
  const f = (x: number) => riskScaled(m, x).toFixed(1);
  return (g.from == null ? "0" : f(g.from)) + "–" + (g.to == null ? "10" : f(g.to));
}

/**
 * The held-out scores' histogram on the 0–10 scale, with a dashed line and its value at each cut
 * (raw scores), `width` wide from x0. Returns the drawing, its height, and the plot's left and
 * right edges with the scale they span — so a control laid over it (the risk-groups dialog's
 * slider) can sit exactly on the axis.
 */
export function scoreHistogram(m: Risk, p: ReturnType<typeof palette>, x0: number, y0: number, width: number, cuts: number[]):
  { svg: string; height: number; plotL: number; plotR: number; plotH: number; domain: [number, number] } {
  const out: string[] = [];
  const R = 16, HH = 64, yy = y0;
  const ex = m.histogram.edges.map((e) => riskScaled(m, e));
  const hy = linear(0, Math.max(1, ...m.histogram.counts), yy + HH, yy, { count: 2 });
  const hL = x0 + 8 + leftAxisWidth(hy, "patients"), hR = x0 + width - R;
  const hx = linear(Math.min(0, ex[0]), Math.max(10, ex[ex.length - 1]), hL, hR, { nice: false });
  hx.ticks = [0, 2, 4, 6, 8, 10].filter((t) => t >= hx.domain[0] && t <= hx.domain[1]);
  out.push(axisLeft(hy, hL, p, { title: "patients", gridTo: hR }));
  let bars = "";
  m.histogram.counts.forEach((c, k) => {
    const a = hx(ex[k]), b = hx(ex[k + 1]), top = hy(c);
    if (c) bars += `M${r1(a + 0.5)} ${r1(yy + HH)}V${r1(top)}H${r1(Math.max(a + 1, b - 0.5))}V${r1(yy + HH)}Z`;
  });
  out.push(`<path d="${bars}" fill="${p.muted}" opacity="0.55"/>`);
  let cutRight = -Infinity;
  for (const raw of cuts) {
    const v0 = riskScaled(m, raw), x = r1(hx(v0));
    out.push(`<line x1="${x}" y1="${yy - 2}" x2="${x}" y2="${yy + HH}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-dasharray="3 2"/>`);
    // each cut's value over its line, where it clears the last; every cut is also in the table's score column
    const t = v0.toFixed(1), tw = textWidth(t, FS.small), cx = Math.max(hL + tw / 2, Math.min(hR - tw / 2, x));
    if (cx - tw / 2 < cutRight + 4) continue;
    out.push(label(cx, yy - 4, t, { size: FS.small, fill: p.ink, anchor: "middle" }));
    cutRight = cx + tw / 2;
  }
  const hTitle = "risk score, 0–10 — lower risk ← → higher risk";
  out.push(axisBottom(hx, yy + HH, p, { title: hTitle, minX: x0, maxX: x0 + width }));
  return { svg: out.join(""), height: HH + bottomAxisHeight(hTitle), plotL: hL, plotR: hR, plotH: HH, domain: hx.domain };
}

/**
 * Where a cut at percentile `p` lands, by the engine's rule (groupRiskmodel): patients with the same
 * score stay together, so a cut inside a run of tied scores moves to the run's nearer edge (the lower
 * one when they are as near). Read from `percentiles` (the score at each whole percentile), so it is
 * right to about a percentile: what the risk-groups dialog previews.
 */
export function cutLandsAt(percentiles: number[], p: number): number {
  const v = percentiles[p];
  let a = p, b = p;
  while (a > 0 && percentiles[a - 1] === v) a--;
  while (b < 100 && percentiles[b + 1] === v) b++;
  if (a === b) return p;
  // the run holds percentiles a…b: a cut before it leaves the lower group a%, after it b + 1%
  return p - a <= b + 1 - p ? a : Math.min(100, b + 1);
}

/** The risk groups' names, low to high, for `n` groups. */
export function riskGroupNames(n: number): string[] {
  return n === 1 ? ["All patients (the scores do not separate them)"] : n === 2 ? ["Low risk", "High risk"]
    : n === 3 ? ["Low risk", "Intermediate risk", "High risk"]
    : Array.from({ length: n }, (_, g) => "Risk group " + (g + 1) + " of " + n);
}

/** The score histogram alone, framed at `width`, with lines at `cuts` (raw scores): the risk-groups dialog's. */
export function riskHistogramFigure(m: Risk, width: number, cuts: number[], theme?: SvgOpts["theme"]) {
  const p = palette(theme), top = 16;
  const h = scoreHistogram(m, p, 0, top, width, cuts);
  return { ...h, axisY: top + h.plotH, svg: frame(width, top + h.height + 4, h.svg, p.bg, false, "Risk score histogram with the group cuts") };
}

/** the volcano stays about square: wider than this it would stretch the hazard ratios apart */
const VOLCANO_MAX_W = 760;

/**
 * OncoCast's volcano: every gene kept in at least one run, its mean hazard ratio where kept (log
 * scale, so equal effects either way are equal distances from 1) against the share of runs that
 * kept it, sized by the patients mutated. The genes kept in at least `labelAbove` of the runs are
 * named where a label fits; the rest of those are listed under it.
 */
function riskVolcano(m: Risk, p: ReturnType<typeof palette>, x0: number, y0: number, width: number): { svg: string; height: number } {
  const out: string[] = [];
  const share = (x: number) => fmtPct(x * 100, 0);
  out.push(label(x0 + 8, y0, "Selection frequency against mean hazard ratio (labelled: kept in ≥ " + share(m.labelAbove) + " of runs)",
    { size: FS.title, fill: p.ink, weight: 600, maxW: width - 16 }));
  const fs = m.features;
  if (!fs.length) {
    out.push(label(x0 + 8, y0 + FS.title + 8, "No gene was kept in any run.", { size: FS.body, fill: p.muted }));
    return { svg: out.join(""), height: FS.title + 12 };
  }
  const T = y0 + 14, PH = Math.round(Math.max(220, Math.min(340, width * 0.55)));
  const yTitle = "share of runs kept";
  // room above the top row for its labels: a gene every run kept sits there, often with many others
  const ys = linear(0, 1, T + PH - 6, T + 6 + FS.small * 2.5, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const L = x0 + 8 + leftAxisWidth(ys, yTitle, share), Rx = x0 + width - 12;
  const span = Math.max(1.5, ...fs.map((f) => Math.max(f.hr, 1 / f.hr))) * 1.1;
  const xs = log(1 / span, span, L + 8, Rx - 8, { nice: false });
  const xTitle = "mean hazard ratio where kept (log scale) — favourable ← → adverse";
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: Rx, fmt: share }));
  out.push(axisBottom(xs, T + PH, p, { title: xTitle, minX: x0, maxX: x0 + width, gridTo: T }));
  out.push(`<line x1="${r1(xs(1))}" y1="${T}" x2="${r1(xs(1))}" y2="${T + PH}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  // the label threshold
  const ty = r1(ys(m.labelAbove));
  out.push(`<line x1="${L}" y1="${ty}" x2="${Rx}" y2="${ty}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="4 3"/>`);
  const maxMut = Math.max(1, ...fs.map((f) => f.mutated));
  const rOf = (n: number) => 2.2 + 4.8 * Math.sqrt(n / maxMut);
  const at = fs.map((f) => ({ f, x: xs(Math.min(span, Math.max(1 / span, f.hr))), y: ys(f.selected), r: rOf(f.mutated) }));
  // largest first, so a small point is never hidden under a large one
  out.push([...at].sort((a, b) => b.r - a.r).map(({ f, x, y, r }) =>
    `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${f.hr < 1 ? FAVOURABLE : ADVERSE}" opacity="0.7" stroke="${p.bg}" stroke-width="0.5">` +
    `<title>${esc(f.gene + ": kept in " + share(f.selected) + " of runs · mean HR " + fmtRatio(f.hr) + " · " + fmtInt(f.mutated) + " mutated")}</title></circle>`).join(""));
  const named = at.filter((a) => a.f.selected >= m.labelAbove).sort((a, b) => b.f.selected - a.f.selected || Math.abs(Math.log(b.f.hr)) - Math.abs(Math.log(a.f.hr)));
  const wants: LabelWant[] = named.map((a) => ({ text: a.f.gene, px: a.x, py: a.y, w: textWidth(a.f.gene, FS.small) + 2, h: FS.small + 2 }));
  const pl = placeLabels(wants, { x: L + 1, y: T + 1, w: Rx - L - 2, h: PH - 2 }, at, 3);
  for (const q of pl.placed) {
    if (q.leader) out.push(`<line x1="${r1(q.leader.x1)}" y1="${r1(q.leader.y1)}" x2="${r1(q.leader.x2)}" y2="${r1(q.leader.y2)}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
    out.push(label(q.box.x + 1, q.box.y + FS.small * 0.85, q.text, { size: FS.small, fill: p.ink,
      extra: `stroke="${p.bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` }));
  }
  let y = T + PH + bottomAxisHeight(xTitle);
  const lines: string[] = ["Point size: patients mutated (largest " + fmtInt(maxMut) + "). " + fmtInt(named.length) + " of " + fmtInt(fs.length) +
    " genes kept in ≥ " + share(m.labelAbove) + " of runs are named."];
  const note = unplacedNote(pl.unplaced, named.length, "genes");
  if (note) lines.push(note);
  const para = paragraph(lines.join(" "), x0 + 8, y + 4, width - 16, p.muted, { size: FS.small });
  out.push(para.svg);
  y += 4 + para.height;
  return { svg: out.join(""), height: y - y0 };
}

/**
 * The risk model: Kaplan–Meier curves of the risk groups, then the genes the model kept most
 * often with their mean hazard ratio (a bar on a log scale about 1), then what the numbers rest on.
 */
/**
 * Table 1 in words, for the figure's caption: the figure does not draw it (the page shows it in a
 * dialog), so an image that travels alone still says what it holds and what it found.
 */
export function table1Words(t: RiskTable1): string {
  const groups = t.groups.map((g) => g.name.replace(/ risk$/, "")).join(" / ");
  const shown = t.rows.filter((r) => r.kind !== "skipped");
  const share = (n: number, of: number) => of ? fmtPct(100 * n / of) : "–";
  const summary = (r: typeof shown[number]): string => {
    if (r.kind === "gene") return r.name + " mutated in " + r.perGroup.map((c) => share(c.altered, c.profiled)).join(" / ") + " of patients whose panels cover it";
    if (r.kind === "num") return r.name + " median " + r.perGroup.map((c) => c.median == null ? "–" : fmtNum(c.median)).join(" / ");
    const top = r.levels[0];
    return r.name + " " + top.value + " in " + top.counts.map((n, gi) => share(n, top.counts[gi] + r.levels.slice(1).reduce((s, l) => s + l.counts[gi], 0))).join(" / ");
  };
  const stat = (r: typeof shown[number]) => r.q != null ? " (" + fmtQ(r.q) + ")" : r.p != null ? " (" + fmtP(r.p) + ")" : r.untested ? " (not tested: " + r.untested + ")" : "";
  const open = shown.filter((r) => r.role !== "in the model" && r.role !== "outcome");
  const differ = open.filter((r) => r.q != null && r.q < 0.05), rest = open.filter((r) => !differ.includes(r));
  const built = shown.filter((r) => r.role === "in the model" || r.role === "outcome");
  const set = t.rows.filter((r) => r.kind === "skipped");
  return "Table 1 (not drawn; in the result) compares the groups (" + groups + ", " + t.groups.map((g) => fmtInt(g.n)).join(" / ") + " patients" +
    (t.reportedOn === "validation half" ? ", the validation half" : "") + ") on " + shown.length + " rows, each tested across groups (χ² or Kruskal–Wallis), q-values Benjamini–Hochberg over " + t.tested + " of them; a category's share is of the patients with a value. " +
    (differ.length ? "Differ at q < 0.05: " + differ.map((r) => summary(r) + stat(r)).join("; ") + ". " : "No open row differs at q < 0.05. ") +
    (rest.length ? "Not at q < 0.05: " + rest.map((r) => summary(r) + stat(r)).join("; ") + ". " : "") +
    (built.length ? "Different by construction, so no q-value: " + built.map((r) => summary(r) + " (" + r.role + (r.p != null ? ", " + fmtP(r.p) : "") + ")").join("; ") + ". " : "") +
    (t.omitted.length ? "Left out of the default attributes: " + t.omitted.map((o) => o.name + " (" + o.why + ")").join("; ") + ". " : "") +
    (set.length ? "Set aside: " + set.map((r) => r.name + " (" + (r as { skipped: string }).skipped + ")").join("; ") + ". " : "");
}

export function riskmodelSvg(v: DrawnResultOf<"riskmodel">, o: SvgOpts): string {
  const m = v.riskmodel;
  const p = palette(o.theme);
  let W = Math.max(480, o.width || 720), grown = false;

  // the group table's columns, measured
  const pc = (x: number | null) => x == null ? "—" : fmtShare(x, 0);
  const rows = m.groups.map((g, i) => [g.name, riskSpan(m, g), fmtInt(g.curve.n) + " · " + fmtInt(g.curve.events),
    g.curve.median == null ? "not reached" : fmtMonths(g.curve.median), pc(g.at12), pc(g.at36),
    g.hr == null ? (i === 0 ? "reference" : "—") : fmtRatio(g.hr) + " [" + fmtRatio(g.ciLow!) + "–" + fmtRatio(g.ciHigh!) + "]",
    g.p == null ? "" : fmtP(g.p)]);
  const heads = ["group", "score (0–10)", "patients · events", "median", "12 mo", "36 mo", "HR vs lowest [95% CI]", ""];
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
  out.push(label(8, yy, "Risk score, 0–10 (" + m.reportedOn + "), with the group cuts", { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 }));
  yy += 10 + FS.small + 2;
  const hist = scoreHistogram(m, p, 0, yy, W, m.groups.slice(1).flatMap((g) => g.from == null ? [] : [g.from]));
  out.push(hist.svg);
  yy += hist.height + 18;

  const vol = riskVolcano(m, p, 0, yy, Math.min(W, VOLCANO_MAX_W));
  out.push(vol.svg);
  yy += vol.height + 18;

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
    m.minMutated + "); elastic net, alpha " + m.alpha + ", seed " + m.seed + "." +
    " The risk score is OncoCast's 0–10 scale: 0 and 10 are the lowest and highest " + (m.validation ? "held-out score in the discovery half, so a validation patient can fall outside them" : "held-out score") +
    " (raw linear predictor " + fmtNum(m.scale.min) + " to " + fmtNum(m.scale.max) + ")." +
    (m.candidates > m.features.length ? " " + fmtInt(m.candidates - m.features.length) + " of the " + fmtInt(m.candidates) + " candidate genes were never kept, so are not on the volcano." : "") +
    (left.length ? " Left out: " + left.join("; ") + "." : "") +
    (m.features.length > shown.length ? " " + (m.features.length - shown.length) + " more genes were kept in at least one run; they are in the result, not drawn." : "") +
    (m.table1 ? " " + table1Words(m.table1) : "") +
    " " + (v.caveat || "");
  const cap = caption(text, W, yy + 4, p.muted);
  return frame(W, yy + 4 + cap.height + 8, out.join("") + cap.svg, p.bg, grown,
    "Risk model — " + m.groups.map((g) => g.name).join(", "));
}
