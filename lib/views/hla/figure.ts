// HLA figure: per cohort, the share of fully typed patients homozygous at 0, 1 or 2+ class I loci
// and the share with HLA LOH, as 100% bars; then the endpoint by homozygosity and by HLA LOH.
import type { DrawnResultOf } from "../../types.ts";
import {
  esc, palette, frame, caption, label, legend, paragraph, textWidth, textOn, fmtInt, fmtShare, fmtP, fmtRatio, fmtMonths, FS, SERIES, OTHER, r1, type SvgOpts
} from "../../svg-kit.ts";
import { kmPanel } from "../../figures/km.ts";
import type { HlaSplit, HlaHr } from "./types.ts";

const PAD = 8, BAR = 16, ROWH = 24, GAP = 28;
const HOM_COLORS = [SERIES[0], SERIES[1], SERIES[2]], LOSS = SERIES[5];

const hrText = (name: string, h: HlaHr | null) => h ? name + " HR " + fmtRatio(h.hr) + " [95% CI " + fmtRatio(h.ciLow) + "–" + fmtRatio(h.ciHigh) + "], " + fmtP(h.p) + " (n = " + fmtInt(h.n) + ")" : name + " HR not estimable";

export function hlaSvg(v: DrawnResultOf<"hla">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.hla;
  const W = Math.max(480, o.width || 936);
  const out: string[] = [];
  let y = 4;
  const lg = legend([
    { label: "homozygous at 0 loci", color: HOM_COLORS[0] }, { label: "1 locus", color: HOM_COLORS[1] }, { label: "2–3 loci", color: HOM_COLORS[2] },
    { label: "HLA LOH", color: LOSS }, { label: "no HLA LOH", color: OTHER }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 8;
  const rowNames = ["class I homozygosity", "HLA LOH"];
  const nameW = Math.max(...rowNames.map((s) => textWidth(s, FS.small)));
  const BL = PAD + nameW + 14, BR = W - PAD;
  const bar = (yy: number, parts: { n: number; color: string; what: string }[], total: number, rowName: string, empty: string) => {
    out.push(label(PAD, yy + BAR / 2 + FS.small * 0.35, rowName, { size: FS.small, fill: p.muted }));
    if (!total) { out.push(label(BL, yy + BAR / 2 + FS.small * 0.35, empty, { size: FS.small, fill: p.muted, maxW: BR - BL })); return; }
    let x = BL;
    for (const part of parts) {
      if (part.n <= 0) continue;
      const w = (BR - BL) * part.n / total;
      out.push(`<rect x="${r1(x)}" y="${r1(yy)}" width="${r1(Math.max(1, w))}" height="${BAR}" fill="${part.color}"><title>${esc(fmtInt(part.n) + " of " + fmtInt(total) + " " + part.what)}</title></rect>`);
      const t = fmtShare(part.n / total, 1);
      if (textWidth(t, FS.small) + 6 <= w) out.push(label(x + w / 2, yy + BAR / 2 + FS.small * 0.35, t, { size: FS.small, fill: textOn(part.color), anchor: "middle" }));
      x += w;
    }
  };
  r.panels.forEach((pn, pi) => {
    if (pi) y += 18;
    out.push(label(PAD, y + FS.title, pn.cohort, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
    y += FS.title + 4;
    const detail = fmtInt(pn.typed) + " of " + fmtInt(pn.patients) + " patients typed at HLA-A, -B and -C · homozygous " +
      pn.loci.map((l) => "HLA-" + l.locus + " " + (l.typed ? fmtShare(l.homozygous / l.typed, 1) : "–")).join(", ") +
      " · HLA LOH called in " + fmtInt(pn.lohEvaluated) + " patients";
    const para = paragraph(detail, PAD, y, W - 2 * PAD, p.muted, { size: FS.small });
    out.push(para.svg);
    y += para.height + 4;
    bar(y, [{ n: pn.homozygous[0], color: HOM_COLORS[0], what: "typed patients heterozygous at all three loci" },
      { n: pn.homozygous[1], color: HOM_COLORS[1], what: "typed patients homozygous at one locus" },
      { n: pn.homozygous[2] + pn.homozygous[3], color: HOM_COLORS[2], what: "typed patients homozygous at two or three loci" }], pn.typed, rowNames[0], "no patient typed at all three loci");
    y += ROWH;
    bar(y, [{ n: pn.loh, color: LOSS, what: "patients with an HLA LOH call who have a loss" },
      { n: pn.lohEvaluated - pn.loh, color: OTHER, what: "patients with an HLA LOH call who have none" }], pn.lohEvaluated, rowNames[1], "no sample has an HLA LOH call");
    y += ROWH + 6;
    const side = W >= 760;
    const KW = side ? Math.floor((W - GAP) / 2) : W;
    const a = splitPanel(pn.byHomozygosity, pn.byHomozygosityWhy, r.endpoint + " by homozygosity", KW, r.endpoint, r.covariates, p);
    const b = splitPanel(pn.byLoh, pn.byLohWhy, r.endpoint + " by HLA LOH", KW, r.endpoint, r.covariates, p);
    if (side) {
      out.push(`<g transform="translate(0 ${r1(y)})">${a.svg}</g><g transform="translate(${KW + GAP} ${r1(y)})">${b.svg}</g>`);
      y += Math.max(a.height, b.height);
    } else {
      out.push(`<g transform="translate(0 ${r1(y)})">${a.svg}</g>`);
      y += a.height + 8;
      out.push(`<g transform="translate(0 ${r1(y)})">${b.svg}</g>`);
      y += b.height;
    }
  });
  const cap = caption(v.caveat || "", W, y + 4, p.muted);
  return frame(W, y + 4 + cap.height + 10, out.join("") + cap.svg, p.bg, false, "HLA class I genotype");
}

/** one split's KM panel at (0, 0) with its log-rank and hazard ratios below, or a line saying why it is not drawn */
function splitPanel(s: HlaSplit | null, why: string | undefined, title: string, W: number, endpoint: string, covariates: string[], p: ReturnType<typeof palette>):
  { svg: string; height: number } {
  if (!s) {
    const para = paragraph(title + " not drawn: " + (why || "no data"), PAD, 0, W - 2 * PAD, p.muted, { size: FS.small });
    return { svg: para.svg, height: para.height + 6 };
  }
  const km = kmPanel(s.curves.map((c) => ({ name: c.label, points: c.points, atRisk: c.atRisk,
    detail: "median " + (c.median == null ? "not reached" : fmtMonths(c.median)) + " · n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " events" })),
  { y0: 0, W, p, xTitle: "Months (" + endpoint + ")", yTitle: "Survival probability", title });
  const out = [km.svg];
  let y = km.height + 2;
  const lines = [(s.logrank ? "log-rank " + fmtP(s.logrank.p) + (s.logrank.strata > 1 ? " (stratified by study)" : "") + " · " : "") + hrText(s.curves[0].label + " vs not:", s.hr),
    ...(covariates.length ? [hrText("adjusted for " + covariates.join(", ") + ":", s.adjusted)] : [])];
  for (const l of lines) { const para = paragraph(l, PAD, y, W - 2 * PAD, p.ink, { size: FS.small }); out.push(para.svg); y += para.height; }
  return { svg: out.join(""), height: y + 4 };
}
