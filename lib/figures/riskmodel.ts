// Risk model figure: the risk groups' survival curves and the genes the model kept.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";

/** a hazard ratio below 1 and above it take the shared series' blue and vermillion */
const FAVOURABLE = SERIES[0], ADVERSE = SERIES[4];

/** How many of the model's genes the figure lists; the rest are in the result and said in the caption. */
export const RISK_FIGURE_GENES = 15;

/**
 * The risk model: Kaplan–Meier curves of the risk groups, then the genes the model kept most
 * often with their mean hazard ratio (a bar on a log scale about 1), then what the numbers rest on.
 */
export function riskmodelSvg(v: ViewResult, o: SvgOpts): string {
  const m = v.riskmodel!;
  const p = palette(o.theme), W = o.width || 720;
  const L = 46, R = 12, T = 12, PLOT = 230;
  const curves = m.groups.map((g) => g.curve);
  const tMax = Math.max(1, ...curves.flatMap((c) => c.points.map((q) => q.t)));
  const step = tMax > 120 ? 24 : tMax > 60 ? 12 : 6;
  const x = (t: number) => L + (W - L - R) * t / tMax;
  const y = (sv: number) => T + PLOT * (1 - sv);
  const out: string[] = [];
  for (const sv of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line x1="${L}" y1="${num(y(sv))}" x2="${W - R}" y2="${num(y(sv))}" stroke="${p.line}" stroke-width="1"/>`);
    out.push(`<text x="8" y="${num(y(sv) + 3)}" font-size="10" fill="${p.muted}">${Math.round(sv * 100)}%</text>`);
  }
  for (let t = 0; t <= tMax; t += step) out.push(`<text x="${num(x(t) - 8)}" y="${T + PLOT + 14}" font-size="10" fill="${p.muted}">${t}mo</text>`);
  curves.forEach((c, i) => {
    let d = `M ${num(x(0))} ${num(y(1))}`, py = y(1);
    for (const q of c.points) { d += ` L ${num(x(q.t))} ${num(py)} L ${num(x(q.t))} ${num(y(q.s))}`; py = y(q.s); }
    d += ` L ${num(x(tMax))} ${num(py)}`;
    out.push(`<path d="${d}" fill="none" stroke="${SERIES[i % SERIES.length]}" stroke-width="2"/>`);
  });
  let yy = T + PLOT + 24;
  // one row per group: size, median, survival at 12 and 36 months, hazard ratio against the lowest group
  const pc = (x: number | null) => x == null ? "—" : Math.round(x * 100) + "%";
  const cols = [22, 210, 290, 360, 420, 480];
  ["group", "patients · events", "median", "12 mo", "36 mo", "HR vs lowest (95% CI)"].forEach((h, k) =>
    out.push(`<text x="${cols[k]}" y="${yy + 8}" font-size="10" fill="${p.muted}">${esc(h)}</text>`));
  yy += 15;
  m.groups.forEach((g, i) => {
    out.push(`<rect x="8" y="${yy}" width="9" height="9" rx="2" fill="${SERIES[i % SERIES.length]}"/>`);
    const cells = [g.name, fmt(g.curve.n) + " · " + fmt(g.curve.events), g.curve.median == null ? "not reached" : num(g.curve.median) + " mo",
      pc(g.at12), pc(g.at36), g.hr == null ? (i === 0 ? "reference" : "—") : g.hr.toFixed(2) + " (" + g.ciLow!.toFixed(2) + "–" + g.ciHigh!.toFixed(2) + ") " + pFmt(g.p!)];
    cells.forEach((c, k) => out.push(`<text x="${cols[k]}" y="${yy + 8}" font-size="11" fill="${p.ink}">${esc(c)}</text>`));
    yy += 16;
  });
  if (m.logrank) { out.push(`<text x="8" y="${yy + 8}" font-size="11" fill="${p.ink}">log-rank χ²=${num(m.logrank.chi2)} (${m.logrank.df} df) · ${esc(pFmt(m.logrank.p))}` +
    (m.logrank.strata > 1 ? ` · stratified by ${esc(m.strata || "")}, ${m.logrank.strata} strata` : "") + `</text>`); yy += 16; }
  if (m.refit) { out.push(`<text x="8" y="${yy + 8}" font-size="11" fill="${p.ink}">risk score alone: HR ${m.refit.hr.toFixed(2)} per standard deviation (95% CI ${m.refit.ciLow.toFixed(2)}–${m.refit.ciHigh.toFixed(2)}) · ${esc(pFmt(m.refit.p))}</text>`); yy += 16; }
  out.push(`<text x="8" y="${yy + 8}" font-size="11" fill="${p.ink}">held-out C-index ${m.cIndex.median.toFixed(3)} (IQR ${m.cIndex.q1.toFixed(3)}–${m.cIndex.q3.toFixed(3)}) over ${m.runs} runs` +
    (m.validation ? ` · on the validation half: ${m.validation.cIndex.toFixed(3)} (${fmt(m.validation.validation)} patients never trained on)` : "") + `</text>`);
  yy += 16;
  if (m.covariates.length) {
    out.push(`<text x="8" y="${yy + 8}" font-size="11" fill="${p.ink}">adjusted for (always in the model): ${esc(m.covariates.map((c) => c.name + " HR " + c.hr.toFixed(2)).join(" · "))}</text>`);
    yy += 16;
  }
  // the distribution of the score the groups are cut from, with the cuts
  yy += 10;
  const hh = 46, hx0 = L, hx1 = W - R, hmax = Math.max(1, ...m.histogram.counts);
  const ex = m.histogram.edges, hxOf = (v: number) => hx0 + (hx1 - hx0) * (v - ex[0]) / ((ex[ex.length - 1] - ex[0]) || 1);
  out.push(`<text x="8" y="${yy}" font-size="11" font-weight="600" fill="${p.ink}">Risk score (${esc(m.reportedOn)}), with the group cuts</text>`);
  yy += 6;
  m.histogram.counts.forEach((c, k) => {
    const x0 = hxOf(ex[k]), x1 = hxOf(ex[k + 1]), h = hh * c / hmax;
    out.push(`<rect x="${num(x0 + 0.5)}" y="${num(yy + hh - h)}" width="${num(Math.max(0.5, x1 - x0 - 1))}" height="${num(h)}" fill="${p.muted}" opacity="0.55"/>`);
  });
  m.groups.slice(1).forEach((g) => { if (g.from != null) { const x = hxOf(g.from);
    out.push(`<line x1="${num(x)}" y1="${yy - 2}" x2="${num(x)}" y2="${yy + hh}" stroke="${p.ink}" stroke-width="1" stroke-dasharray="3 2"/>`); } });
  out.push(`<text x="${hx0}" y="${yy + hh + 12}" font-size="10" fill="${p.muted}">lower risk</text>`);
  out.push(`<text x="${hx1}" y="${yy + hh + 12}" font-size="10" fill="${p.muted}" text-anchor="end">higher risk</text>`);
  yy += hh + 32;
  // genes kept most often: selection share, and the mean hazard ratio as a bar about HR = 1 on a log scale
  const shown = m.features.slice(0, RISK_FIGURE_GENES);
  out.push(`<text x="8" y="${yy}" font-size="11" font-weight="600" fill="${p.ink}">Genes kept most often (share of runs · mean hazard ratio where kept)</text>`);
  yy += 8;
  const LEFT = 150, RIGHT = 120, mid = LEFT + (W - LEFT - RIGHT) / 2, half = (W - LEFT - RIGHT) / 2;
  const span = Math.max(Math.log(2), ...shown.map((f) => Math.abs(Math.log(f.hr))));
  shown.forEach((f) => {
    const w = Math.max(1, Math.abs(Math.log(f.hr)) / span * half);
    out.push(`<text x="8" y="${yy + 11}" font-size="10" fill="${p.ink}">${esc(f.gene)} <tspan fill="${p.muted}">${Math.round(f.selected * 100)}% · ${fmt(f.mutated)} mutated</tspan></text>`);
    out.push(`<rect x="${num(f.hr < 1 ? mid - w : mid)}" y="${yy + 3}" width="${num(w)}" height="8" rx="2" fill="${f.hr < 1 ? FAVOURABLE : ADVERSE}" opacity="0.85"/>`);
    out.push(`<line x1="${num(mid)}" y1="${yy + 1}" x2="${num(mid)}" y2="${yy + 13}" stroke="${p.muted}" stroke-width="1" opacity="0.5"/>`);
    out.push(`<text x="${W - 8}" y="${yy + 11}" font-size="10" fill="${p.muted}" text-anchor="end">HR ${f.hr.toFixed(2)}</text>`);
    yy += 16;
  });
  const left = [m.notProfiled ? fmt(m.notProfiled) + " with no mutation panel on record" : "", m.noStratum ? fmt(m.noStratum) + " with no " + m.strata : "",
    m.noCovariate ? fmt(m.noCovariate) + " missing a covariate" : "", m.noAnchor ? fmt(m.noAnchor) + " with no " + m.anchoredTo + " event" : "",
    m.anchorAfterStart ? fmt(m.anchorAfterStart) + " whose " + m.anchoredTo + " came after the study's day 0" : "",
    m.noFollowUp ? fmt(m.noFollowUp) + " with no follow-up after entry" : "",
    m.neverHeldOut ? fmt(m.neverHeldOut) + " never held out (so unscored and in no group)" : ""].filter(Boolean);
  const text = fmt(m.n) + " patients, " + fmt(m.events) + " events" + (m.anchoredTo ? ", clock from " + m.anchoredTo : "") +
    (m.validation ? " (trained on " + fmt(m.validation.discovery) + " in the discovery half, reported on " + fmt(m.validation.validation) + " in the validation half)" : "") +
    "; " + m.candidates + " candidate genes (of " + m.genesCovered + " covered for every patient, mutated in ≥" +
    m.minMutated + "); elastic net, alpha " + m.alpha + ", seed " + m.seed + "." + (left.length ? " Left out: " + left.join("; ") + "." : "") +
    (m.features.length > shown.length ? " " + (m.features.length - shown.length) + " more genes were kept in at least one run; they are in the result, not drawn." : "") +
    " " + (v.caveat || "");
  const cap = caption(text, W, yy + 8, p.muted);
  return frame(W, yy + cap.height + 18, out.join("") + cap.svg, p.bg);
}
