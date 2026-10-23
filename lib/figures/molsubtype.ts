// Molecular-subtype figure: each cohort's classified patients as one stacked bar of subtype shares,
// and beneath it one bar per group of the `by` attribute; then overall survival by subtype.
import type { DrawnResultOf, MolsubtypeCounts } from "../types.ts";
import { palette, frame, caption, label, legend, textWidth, seriesStyle, textOn, fmtInt, fmtPct, fmtNum, fmtP, num, FS, type SvgOpts } from "../svg-kit.ts";
import { kmPanel } from "./km.ts";

const PAD = 8, BAR_H = 18, GAP = 6;
const NAMES: Record<string, string> = { POLEmut: "POLE-ultramutated", MMRd: "MMR-deficient", p53abn: "p53-abnormal", NSMP: "NSMP" };
const nameOf = (s: string) => NAMES[s] || s;

export function molsubtypeSvg(v: DrawnResultOf<"molsubtype">, o: SvgOpts): string {
  const r = v.molsubtype, p = palette(o.theme), want = o.width || 936, W = Math.max(400, want);
  const out: string[] = [];
  let y = 0;
  const lg = legend(r.subtypes.map((s, i) => ({ label: nameOf(s), color: seriesStyle(i).color, kind: "rect" as const })), PAD, y + 4, W - 2 * PAD, p);
  out.push(lg.svg);
  y += lg.height + 10;
  const rowLabels = r.panels.flatMap((pn) => [pn.cohort, ...(pn.groups || []).map((g) => g.label)]);
  const labelW = Math.min(W * 0.28, Math.max(...rowLabels.map((l) => textWidth(l, FS.body))) + 12);
  const countW = textWidth("n = 00,000 · 0,000 not classifiable", FS.small) + 10;
  const showCount = W - 2 * PAD - labelW - countW > 200;
  const barX = PAD + labelW, barW = W - PAD - barX - (showCount ? countW : 0);
  const bar = (name: string, c: MolsubtypeCounts, bold: boolean) => {
    out.push(label(barX - 6, y + BAR_H / 2 + FS.body * 0.35, name, { size: FS.body, fill: p.ink, anchor: "end", weight: bold ? 600 : 400, maxW: labelW - 8 }));
    let x = barX;
    c.counts.forEach((k, i) => {
      if (!k || !c.classified) return;
      const w = barW * k / c.classified, color = seriesStyle(i).color, share = fmtPct(100 * k / c.classified, 0);
      out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0.5, w))}" height="${BAR_H}" fill="${color}"><title>${name}: ${nameOf(r.subtypes[i])} ${fmtInt(k)} of ${fmtInt(c.classified)} classified (${fmtPct(100 * k / c.classified)})</title></rect>`);
      if (w > textWidth(share, FS.small) + 6) out.push(label(x + w / 2, y + BAR_H / 2 + FS.small * 0.35, share, { size: FS.small, fill: textOn(color), anchor: "middle" }));
      x += w;
    });
    if (showCount) out.push(label(barX + barW + 6, y + BAR_H / 2 + FS.small * 0.35, "n = " + fmtInt(c.classified) + (c.notClassifiable ? " · " + fmtInt(c.notClassifiable) + " not classifiable" : ""), { size: FS.small, fill: p.muted, maxW: countW - 6 }));
    y += BAR_H + GAP;
  };
  for (const pn of r.panels) {
    bar(pn.cohort, pn, true);
    if (pn.groups?.length) {
      out.push(label(PAD, y + FS.small, "by " + r.by + (pn.byTest ? " · χ² " + fmtNum(pn.byTest.chi2) + " (" + pn.byTest.df + " df), " + fmtP(pn.byTest.p) : ""), { size: FS.small, fill: p.muted, maxW: W - 2 * PAD }));
      y += FS.small + 6;
      for (const g of pn.groups) bar(g.label, g, false);
    }
    y += 6;
  }
  if (r.cohortTest) { out.push(label(PAD, y + FS.body, "Between cohorts: χ² " + fmtNum(r.cohortTest.chi2) + " (" + r.cohortTest.df + " df), " + fmtP(r.cohortTest.p), { size: FS.body, fill: p.ink, maxW: W - 2 * PAD })); y += Math.round(FS.body * 1.8); }
  if (!showCount) {
    const counts = r.panels.map((pn) => pn.cohort + ": " + fmtInt(pn.classified) + " classified, " + fmtInt(pn.notClassifiable) + " not classifiable").join(" · ");
    const c = caption(counts, W, y, p.ink);
    out.push(c.svg); y += c.height + 4;
  }

  for (const s of r.survival || []) {
    y += 8;
    const idx = (sub: string) => r.subtypes.indexOf(sub);
    const km = kmPanel(s.curves.map((c) => ({ name: nameOf(c.subtype), series: idx(c.subtype), points: c.points, atRisk: c.atRisk,
      detail: "n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " deaths · median " + (c.median == null ? "not reached" : fmtNum(Math.round(c.median * 10) / 10) + " mo") })),
    { y0: y, W, p, xTitle: "Months (OS_MONTHS)", yTitle: "Overall survival", title: "Overall survival by subtype — " + s.cohort });
    out.push(km.svg);
    y += km.height + 4;
    const line = s.logrank ? s.logrank.groups + "-group log-rank χ² = " + fmtNum(s.logrank.chi2) + " (" + s.logrank.df + " df) · " + fmtP(s.logrank.p) + (s.logrank.strata > 1 ? " · stratified by study" : "") : s.noTest || "";
    if (line) { out.push(label(PAD, y + FS.body, line, { size: FS.body, fill: p.ink, maxW: W - 2 * PAD })); y += Math.round(FS.body * 1.8); }
  }
  const cap = caption((r.noSurvival ? "No survival panel: " + r.noSurvival + ". " : "") + (v.caveat || ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, "Molecular subtypes — " + r.classifierLabel);
}
