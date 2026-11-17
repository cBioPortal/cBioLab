// Cancer types figure: a gene list's alteration frequency per cancer type, as the portal draws it.
import {
  esc, palette, frame, caption, linear, axisLeft, leftAxisWidth, bandLabels, legend, label, textWidth,
  fmtInt, fmtNum, fmtPct, FS, SW, type SvgOpts, type LegendItem
} from "../../svg-kit.ts";
import type { ViewResultOf, DrawnResultOf } from "../../types.ts";
import { AMP, DEL, MULTI, MUT, SV } from "../../figures/common.ts";
import { STYLE } from "../../oncoprint-style.ts";
import type { CancertypesGroup } from "./types.ts";

type CtResult = NonNullable<ViewResultOf<"cancertypes">["cancertypes"]>;
/** a line's EXP / PROT kinds, in the oncoprint's colours and labels for them */
const level = (opts: readonly { bit: string; color: string; label: string }[], bit: string): [string, string] => {
  const o = opts.find((x) => x.bit === bit)!;
  return [o.label, o.color];
};
/** the kinds in the portal's stack order, bottom first (CancerSummaryContent OrderedAlterationLabelMap); its legend lists them reversed */
const CT_KINDS: [keyof CancertypesGroup, string, string][] = [["multiple", "Multiple Alterations", MULTI],
  ["protLow", ...level(STYLE.glyph.protein.options, "PROT_LOW")], ["protHigh", ...level(STYLE.glyph.protein.options, "PROT_HIGH")],
  ["mrnaLow", ...level(STYLE.glyph.mrna.options, "MRNA_LOW")], ["mrnaHigh", ...level(STYLE.glyph.mrna.options, "MRNA_HIGH")],
  ["homdel", "Deep Deletion", DEL], ["amp", "Amplification", AMP], ["sv", "Structural Variant", SV], ["mutation", "Mutation", MUT]];
const PROFILES: [keyof NonNullable<CancertypesGroup["profiledFor"]>, string, string][] = [["mutation", "Mutation data", "mutation"], ["cna", "CNA data", "CNA"], ["sv", "Structural variant data", "structural variant"]];

/** the portal's name for a category type (CancerSummaryContainer GroupByOptions); any other attribute by its own name */
export function categoryLabel(groupBy: string): string {
  return ({ study: "Cancer Study", CANCER_TYPE: "Cancer Type", CANCER_TYPE_DETAILED: "Cancer Type Detailed" } as Record<string, string>)[groupBy] || groupBy;
}

/**
 * The portal's grey gene tab (CancerSummaryContainer, CTS-GT-4): `gene` (null: the genes together) altered in no
 * unit of any panel's cohort, before the filters.
 */
export function cancertypesUnaltered(r: CtResult, gene: string | null): boolean {
  return r.panels.every((pn) => !geneSource(pn, gene).altered);
}

/** `gene` profiled in no unit of any panel's cohort (its tab's tip says so rather than "no alterations") */
export function cancertypesUnprofiled(r: CtResult, gene: string | null): boolean {
  return r.panels.every((pn) => !geneSource(pn, gene).profiled);
}

/** what one gene's tab draws of a panel: its perGene entry, or the panel itself (the genes together, or a one-gene query) */
export function geneSource(pn: CtResult["panels"][number], gene: string | null | undefined): CtResult["panels"][number] | NonNullable<CtResult["panels"][number]["perGene"]>[number] {
  return (gene && pn.perGene?.find((x) => x.gene === gene)) || pn;
}

/** the portal's filter alert, when a threshold hides some group */
export function filterAlert(r: CtResult, g: { groups: unknown[]; categories: number; filtered?: true }): string | null {
  return g.filtered ? g.groups.length + " of " + g.categories + " categories (" + categoryLabel(r.groupBy) + ") are shown based on filtering." : null;
}

/** a bar's band never narrows below this: labels turned 45° then sit a line of text apart */
const MIN_BAND = 16;
/** nor widens past this: a few groups get bars, not slabs */
const MAX_BAR = 32;
const PAD = 8, PLOT_H = 240, MARK_ROW = 13, LABEL_H = 150;

/**
 * One cohort's Cancer Types Summary as the portal draws it: a vertical bar per group, highest first,
 * stacked by kind of alteration; group names under the bars; the kinds present keyed at the foot.
 * The portal's "+" rows (what each group was profiled for) are drawn only for a data type some
 * groups lack — when every group was profiled for it, one line says so. Laid out for `o.width`; with
 * more groups than fit it grows (`grown`) rather than squeezing bars below a label's height. `gene`
 * picks one gene's bars (the portal's per-gene tabs); omitted, the genes together.
 */
export function cancertypesPanelSvg(r: CtResult, panel: number, o: SvgOpts & { gene?: string | null; title?: boolean;
  /** the page shows its own popover per bar (CTS-CH-7): each bar's marks name their group (data-group) and carry their text as an aria-label, not a <title> */
  popover?: boolean } = {}):
  { body: string; width: number; height: number; grown: boolean } {
  const p = palette(o.theme), pn = r.panels[panel];
  const src = geneSource(pn, o.gene);
  const groups = src.groups;
  const alert = filterAlert(r, src);
  const freq = r.show === "frequency";
  const value = (g: CancertypesGroup, k: keyof CancertypesGroup) => freq ? 100 * Number(g[k] ?? 0) / (g.profiled || 1) : Number(g[k] ?? 0);
  const top = Math.max(1, ...groups.map((g) => value(g, "altered")));
  const yTitle = freq ? "Alteration Frequency" : "Absolute Counts";

  // which data types to mark per group: only those some group was not profiled for
  const known = groups.length > 0 && groups.every((g) => g.profiledFor);
  const marked = known ? PROFILES.filter(([k]) => groups.some((g) => (g.profiledFor![k] || 0) > 0) && groups.some((g) => !(g.profiledFor![k] || 0))) : [];
  const everywhere = known ? PROFILES.filter(([k]) => groups.every((g) => (g.profiledFor![k] || 0) > 0)) : [];

  let W = Math.max(360, o.width || 860);
  const T = (o.title === false ? 10 : 34) + (alert ? 18 : 0);
  const ys = linear(0, freq ? Math.min(100, top) : top, T + PLOT_H, T);
  const yFmt = freq ? (v: number) => fmtNum(v) + "%" : (v: number) => fmtInt(v);
  const markW = Math.max(0, ...marked.map(([, l]) => textWidth(l, FS.small) + 6));
  let L = PAD + Math.max(leftAxisWidth(ys, yTitle, yFmt), markW) + 4;
  const R = 12, n = Math.max(1, groups.length);
  let band = Math.max(MIN_BAND, (W - L - R) / n);
  // labels turned 45° reach left of their bar by up to LABEL_H: the first one must not leave the figure
  const widest = Math.max(0, ...groups.map((g) => textWidth(g.label, FS.small)));
  if (widest > band - 4) {
    const reach = Math.min(LABEL_H, widest * Math.SQRT1_2) + PAD - band / 2;
    if (reach > L) { L = Math.ceil(reach); band = Math.max(MIN_BAND, (W - L - R) / n); }
  }
  const grown = L + R + band * n > W + 0.5;
  if (grown) W = Math.ceil(L + R + band * n);
  const bw = Math.min(MAX_BAR, Math.max(3, band * 0.78));
  const plotR = L + band * groups.length;
  const X = (i: number) => L + i * band + (band - bw) / 2;

  const out: string[] = [];
  if (o.title !== false) {
    const head = pn.cohort, hw = Math.min(textWidth(head, FS.title, 600), W * 0.5);
    out.push(label(PAD, 18, head, { size: FS.title, weight: 600, fill: p.ink, maxW: W * 0.5 }));
    const tot = src;
    out.push(label(PAD + hw + 8, 18, (o.gene ? o.gene + " · " : "") + fmtInt(tot.altered) + " of " + fmtInt(tot.profiled) + " profiled " + r.unit + "s altered (" +
      fmtPct(100 * tot.altered / (tot.profiled || 1)) + ")", { size: FS.small, fill: p.muted, maxW: W - PAD - hw - 8 - PAD }));
  }
  if (alert) out.push(label(PAD, T - 12, alert, { size: FS.small, fill: p.ink, maxW: W - 2 * PAD }));
  if (!groups.length || cancertypesUnaltered(r, o.gene ?? null)) {
    out.push(label(PAD, T + 20, groups.length ? "There are no alterations in this gene." : "No category passes the filters.", { size: FS.body, fill: p.muted, maxW: W - 2 * PAD }));
    return { body: out.join(""), width: W, height: T + 36, grown };
  }
  out.push(axisLeft(ys, L - 4, p, { title: yTitle, gridTo: plotR, fmt: yFmt }));
  out.push(`<line x1="${L - 4}" y1="${T + PLOT_H}" x2="${r1(plotR)}" y2="${T + PLOT_H}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  groups.forEach((g, i) => {
    let y0 = T + PLOT_H;
    const x = r1(X(i));
    for (const [k, name, col] of CT_KINDS) {
      const h = (T + PLOT_H) - ys(Math.min(ys.domain[1], value(g, k)));
      if (h <= 0) continue;
      y0 -= h;
      out.push(o.popover ? `<rect x="${x}" y="${r1(y0)}" width="${r1(bw)}" height="${r1(h)}" fill="${col}" data-group="${esc(g.key)}" role="img" aria-label="${esc(g.label + " — " + name + ": " + fmtInt(Number(g[k] ?? 0)) + " of " + fmtInt(g.profiled) + " profiled " + r.unit + "s")}"/>`
        : `<rect x="${x}" y="${r1(y0)}" width="${r1(bw)}" height="${r1(h)}" fill="${col}"><title>${esc(g.label + " — " + name + ": " + fmtInt(Number(g[k] ?? 0)) + " of " + fmtInt(g.profiled) + " profiled " + r.unit + "s")}</title></rect>`);
    }
    const alt = value(g, "altered");
    if (!o.popover) out.push(`<rect x="${x}" y="${r1(ys(alt))}" width="${r1(bw)}" height="${r1(T + PLOT_H - ys(alt))}" fill="none"><title>${esc(g.label + ": " + fmtPct(100 * g.altered / (g.profiled || 1)) + " (" + fmtInt(g.altered) + " / " + fmtInt(g.profiled) + " " + r.unit + "s" + (g.samples > g.profiled ? ", " + fmtInt(g.samples) + " in the group" : "") + ")")}</title></rect>`);
  });
  // what each group was profiled for, where groups differ
  let y = T + PLOT_H + 4;
  for (const [k, name] of marked) {
    const cy = y + MARK_ROW / 2;
    out.push(label(L - 6, cy + FS.small * 0.35, name, { size: FS.small, fill: p.muted, anchor: "end" }));
    groups.forEach((g, i) => { if ((g.profiledFor![k] || 0) > 0) out.push(label(L + i * band + band / 2, cy + FS.body * 0.35, "+", { size: FS.body, weight: 600, fill: p.ink, anchor: "middle" })); });
    y += MARK_ROW;
  }
  const centers = groups.map((_, i) => L + i * band + band / 2);
  const bl = bandLabels(groups.map((g) => g.label), centers, band, y, p, { maxH: LABEL_H });
  out.push(bl.svg);
  y += bl.height + 6;
  const items: LegendItem[] = [...CT_KINDS].reverse().filter(([k]) => groups.some((g) => Number(g[k] ?? 0) > 0)).map(([, name, col]) => ({ label: name, color: col }));
  const lg = legend(items, L, y, W - L - PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height;
  if (everywhere.length) {
    out.push(label(L, y + FS.small + 2, "Every group was profiled for " + andList(everywhere.map(([, , n]) => n)) + " data.",
      { size: FS.small, fill: p.muted, maxW: W - L - PAD }));
    y += FS.small + 6;
  }
  return { body: out.join(""), width: W, height: y + 8, grown };
}

const andList = (xs: string[]) => xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs.join("");
const r1 = (n: number) => Math.round(n * 10) / 10;

export function cancertypesSvg(v: DrawnResultOf<"cancertypes">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.cancertypes;
  let y = 0, W = Math.max(360, o.width || 860), grown = false;
  const parts: string[] = [];
  r.panels.forEach((_, i) => {
    const c = cancertypesPanelSvg(r, i, { ...o, width: W, title: true });
    parts.push(`<g transform="translate(0 ${y})">${c.body}</g>`);
    y += c.height + 10; W = Math.max(W, c.width); grown ||= c.grown;
  });
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, parts.join("") + cap.svg, p.bg, grown, "Cancer types summary — " + r.genes.join(", "));
}
