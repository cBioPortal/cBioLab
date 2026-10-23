// Instability figure: per cohort, the aneuploidy score and FGA as horizontal boxes from their
// histograms, then each arm's gain and loss frequency as an arm × cohort heatmap.
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, legend, label, textWidth, fmtInt, fmtNum, fmtP, seriesStyle, FS, SW, type SvgOpts
} from "../svg-kit.ts";
import { CN_GAIN, CN_LOSS } from "./common.ts";
import type { DrawnResultOf, InstabilitySpread } from "../types.ts";

const PAD = 8, GUT = 12, BOX_ROW = 22, BOX_H = 12, MIN_CELL = 13, STRIP = 12;

export function instabilitySvg(v: DrawnResultOf<"instability">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.instability;
  let W = Math.max(480, o.width || 960);
  const cohorts = r.panels.map((pn) => pn.cohort);
  const labW = Math.min(Math.max(...cohorts.map((c) => textWidth(c, FS.body, 600)), textWidth("gain", FS.small)) + GUT, 200);
  const nA = r.arms.length;
  const need = PAD + labW + GUT + nA * MIN_CELL + PAD;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const out: string[] = [];
  let y = 4;

  // the two box panels, side by side when there is room, stacked when not
  const sideBySide = W >= 720;
  const panelW = sideBySide ? (W - 2 * PAD - GUT) / 2 : W - 2 * PAD;
  const boxPanel = (x0: number, y0: number, title: string, max: number, get: (i: number) => InstabilitySpread, unit: string) => {
    const parts: string[] = [];
    parts.push(label(x0, y0 + FS.body, title, { size: FS.body, weight: 600, fill: p.ink, maxW: panelW }));
    const top = y0 + FS.body + 8, L = x0 + labW, R = x0 + panelW - GUT;
    const xs = linear(0, max, L, R);
    for (const t of xs.ticks) parts.push(`<line x1="${r1(xs(t))}" y1="${top}" x2="${r1(xs(t))}" y2="${top + cohorts.length * BOX_ROW}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    cohorts.forEach((c, i) => {
      const s = get(i), cy = top + i * BOX_ROW + BOX_ROW / 2, col = seriesStyle(i).color;
      parts.push(label(L - GUT / 2, cy + FS.body * 0.35, c, { size: FS.body, weight: 600, fill: p.ink, anchor: "end", maxW: labW - GUT }));
      if (s.median == null) { parts.push(label(L + 2, cy + FS.small * 0.35, "no segmented sample", { size: FS.small, fill: p.muted })); return; }
      const tip = c + " — median " + fmtNum(s.median) + unit + ", IQR " + fmtNum(s.q1!) + "–" + fmtNum(s.q3!) + ", 5th–95th percentile " + fmtNum(s.p5!) + "–" + fmtNum(s.p95!);
      parts.push(`<line x1="${r1(xs(s.p5!))}" y1="${cy}" x2="${r1(xs(s.p95!))}" y2="${cy}" stroke="${col}" stroke-width="${SW.line}"/>`);
      parts.push(`<rect x="${r1(xs(s.q1!))}" y="${r1(cy - BOX_H / 2)}" width="${r1(Math.max(1, xs(s.q3!) - xs(s.q1!)))}" height="${BOX_H}" fill="${col}" fill-opacity="0.35" stroke="${col}" stroke-width="${SW.line}"><title>${esc(tip)}</title></rect>`);
      parts.push(`<line x1="${r1(xs(s.median))}" y1="${r1(cy - BOX_H / 2)}" x2="${r1(xs(s.median))}" y2="${r1(cy + BOX_H / 2)}" stroke="${p.ink}" stroke-width="${SW.series}"/>`);
    });
    const yA = top + cohorts.length * BOX_ROW;
    parts.push(axisBottom(xs, yA, p, { title: title.replace(/ \(.*/, ""), minX: x0, maxX: x0 + panelW, fmt: (t) => fmtNum(t) }));
    return { svg: parts.join(""), height: yA + bottomAxisHeight(title) - y0 };
  };
  const maxScore = Math.max(1, ...r.panels.map((pn) => pn.scoreSpread.p95 ?? 0), 5);
  const maxFga = Math.min(100, Math.max(10, ...r.panels.map((pn) => pn.fgaSpread.p95 ?? 0)));
  const b1 = boxPanel(PAD, y, "Aneuploidy score (arms altered, of " + nA + ")", Math.ceil(maxScore), (i) => r.panels[i].scoreSpread, " arms");
  const b2 = boxPanel(sideBySide ? PAD + panelW + GUT : PAD, sideBySide ? y : y + b1.height + 8, "Fraction of genome altered (%)", Math.ceil(maxFga), (i) => r.panels[i].fgaSpread, "%");
  out.push(b1.svg, b2.svg);
  y += sideBySide ? Math.max(b1.height, b2.height) : b1.height + 8 + b2.height;
  if (r.test) {
    out.push(label(PAD, y + FS.small + 2, r.test.name + ": aneuploidy score " + fmtP(r.test.scoreP) + " · FGA " + fmtP(r.test.fgaP), { size: FS.small, fill: p.muted, maxW: W - 2 * PAD }));
    y += FS.small + 8;
  }
  y += 10;

  // arm × cohort heatmap: each cohort two strips, gain above loss, shade = share of samples measured
  const maxShare = Math.max(0.05, ...r.panels.flatMap((pn) => pn.arms.map((a) => a.measured ? Math.max(a.gain, a.loss) / a.measured : 0)));
  out.push(label(PAD, y + FS.body, "Arm-level gains and losses — share of the samples measuring each arm, darkest at " + Math.round(100 * maxShare) + "%", { size: FS.body, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
  y += FS.body + 6;
  const lg = legend([{ label: "gain", color: CN_GAIN }, { label: "loss", color: CN_LOSS }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 4;
  const L = PAD + labW, cell = (W - PAD - L) / nA;
  r.panels.forEach((pn, i) => {
    const ry = y + i * (2 * STRIP + 6);
    out.push(label(L - GUT / 2, ry + STRIP + FS.body * 0.35, pn.cohort, { size: FS.body, weight: 600, fill: p.ink, anchor: "end", maxW: labW - GUT }));
    pn.arms.forEach((a, k) => {
      const x = L + k * cell;
      for (const [n, col, dy, what] of [[a.gain, CN_GAIN, 0, "gained"], [a.loss, CN_LOSS, STRIP, "lost"]] as [number, string, number, string][]) {
        const share = a.measured ? n / a.measured : 0;
        out.push(`<rect x="${r1(x + 0.5)}" y="${ry + dy}" width="${r1(Math.max(1, cell - 1))}" height="${STRIP - 1}" fill="${col}" fill-opacity="${(a.measured ? Math.max(0.04, share / maxShare) : 0).toFixed(2)}"` +
          (a.measured ? "" : ` stroke="${p.line}" stroke-width="${SW.hair}"`) + `><title>${esc(pn.cohort + " — " + a.arm + " " + what + " in " + fmtInt(n) + " of " + fmtInt(a.measured) + " samples measuring it (" + (a.measured ? Math.round(100 * share) : 0) + "%)")}</title></rect>`);
      }
    });
  });
  y += r.panels.length * (2 * STRIP + 6) + 2;
  // arm labels: every arm when they fit, otherwise each chromosome's name once
  const armFits = Math.max(...r.arms.map((a) => textWidth(a, FS.small))) + 2 <= cell;
  if (armFits) r.arms.forEach((a, k) => out.push(label(L + k * cell + cell / 2, y + FS.small, a, { size: FS.small, fill: p.muted, anchor: "middle" })));
  else {
    let lastEnd = -Infinity;
    for (let k = 0; k < nA;) {
      const chrom = r.arms[k].slice(0, -1);
      let span = 1;
      while (k + span < nA && r.arms[k + span].slice(0, -1) === chrom) span++;
      const cx = L + (k + span / 2) * cell, half = textWidth(chrom, FS.small) / 2;
      if (cx - half > lastEnd + 2) { out.push(label(cx, y + FS.small, chrom, { size: FS.small, fill: p.muted, anchor: "middle" })); lastEnd = cx + half; }
      k += span;
    }
  }
  y += FS.small + 4 + 8;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "Genomic instability — aneuploidy and FGA");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
