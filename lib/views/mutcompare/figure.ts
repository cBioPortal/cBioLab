// The mutcompare figure: two cohorts' lollipops on one protein, the first above it and the second
// below, as cBioPortal's group-comparison Mutations tab draws them (react-mutation-mapper's
// LollipopPlotNoTooltip with two groups: the codon axis on top, the protein in the middle, each
// half's y axis labelled 0 and its max). The drawing rules — stems, colours, labels, domains — are
// lib/lollipop.ts's, shared with the results page's lollipop; this only places two of them.
import { IMPACT_COLORS, IMPACT_TYPES, filterHotspotGene, cellLabel, type AlterationCell } from "../../lollipop.ts";
import { esc, palette, frame, caption, linear, axisBottom, legend, label, textWidth, textOn, fmtInt, FS, SW, type SvgOpts, type LegendItem } from "../../svg-kit.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { MutcompareGroup, MutcompareLollipop, MutcompareResult } from "./types.ts";

/** "(A) name", the portal's group name with its ordinal */
export const ordinalName = (i: number, name: string) => "(" + String.fromCharCode(65 + i) + ") " + name;

/** the portal's percent in a stem's tooltip: one decimal from 1%, else two digits past the leading zeros */
export function tipPercent(x: number): string {
  if (!(x > 0)) return "0";
  if (x >= 1) return x.toFixed(1);
  const zeros = Math.floor(-Math.log10(x));
  return x.toFixed(Math.min(10, zeros + 2));
}

/** a stem's height on the chosen axis */
export const heightOf = (n: number, g: Pick<MutcompareGroup, "profiled">, axis: MutcompareResult["axis"]) =>
  axis === "percent" ? (g.profiled > 0 ? 100 * n / g.profiled : 0) : n;

/** each cohort's lollipop with the hidden cells left out (lib/lollipop.ts filterHotspotGene) */
export function drawnLollipops(m: MutcompareResult, hide: readonly string[]): MutcompareLollipop[] {
  return m.groups.map((g) => filterHotspotGene(g.lollipop, hide).gene);
}

/** the common y max both halves share, as the portal's (yAxisSameScale): at least 5 patients on a count axis */
export function sharedMax(m: MutcompareResult, drawn: MutcompareLollipop[]): number {
  const top = Math.max(0, ...drawn.flatMap((l, i) => l.positions.map((q) => heightOf(q.n, m.groups[i], m.axis))));
  return m.axis === "count" ? Math.max(5, top) : top > 0 ? top : 1;
}

/** what the app shows beside the plot as controls, in words, for a figure standing alone */
export function mutcompareCaption(v: Pick<DrawnResultOf<"mutcompare">, "mutcompare" | "hide" | "positions">): string {
  const m = v.mutcompare, hide = (v.hide || []) as string[], codons = (v.positions || []) as number[];
  return m.gene + " mutations: " + m.groups.map((g, i) => ordinalName(i, g.name) + " " + fmtInt(g.mutated) + " of " + fmtInt(g.profiled) + " profiled patients mutated").join(" vs ") +
    "; Fisher exact two-sided p for all mutations " + (m.geneP < 1e-10 ? "< 1e-10" : m.geneP.toPrecision(3)) + "." +
    (hide.length ? " Hidden: " + hide.map((c) => cellLabel(c as AlterationCell)).join(", ") + "." : "") +
    (codons.length ? " Selected codon" + (codons.length === 1 ? " " : "s ") + codons.join(", ") + ", drawn with a larger head." : "");
}

/** the figure's fixed vertical layout: the codon axis's top, a half's stem room, the room for its label, the domains' band */
const AX_Y = 4, STEM = 140, LABEL_ROOM = 18, DOMAIN = 24;
/** where the top half's stems start: the protein's top edge */
const TOP_BASE = AX_Y + 6 + FS.small + 6 + LABEL_ROOM + STEM;
/** the protein's vertical centre in the figure, in px from its top, where the two halves mirror (the side panels line up on it) */
export const MUTCOMPARE_MID_Y = TOP_BASE + DOMAIN / 2;

export function mutcompareSvg(v: DrawnResultOf<"mutcompare">, o: SvgOpts, captionText?: string): string {
  const m = v.mutcompare;
  const hide = (v.hide || []) as string[], sel = new Set((v.positions || []) as number[]);
  const p = palette(o.theme), W = Math.max(420, o.width || 760);
  const BACKBONE = 14, STICK = "#BABDB6", R = 16;
  const drawn = drawnLollipops(m, hide);
  const len = Math.max(1, drawn[0].proteinLength);
  const max = sharedMax(m, drawn);
  const pctAxis = m.axis === "percent";
  const tick = (x: number) => pctAxis ? (Math.round(x * 10) / 10).toString() + "%" : fmtInt(Math.round(x));
  // each half's title: the group (bold) and what its axis counts, the portal's two lines
  const titles = m.groups.map((g, i) => [ordinalName(i, g.name), pctAxis ? "% mutated of " + fmtInt(g.profiled) + " profiled pts" : "# patients"]);
  const tickW = Math.max(textWidth(tick(max), FS.small), textWidth("0", FS.small));
  const L = 8 + 2 * (FS.small + 4) + tickW + 10;
  const plotW = W - L - R;
  const x = (pos: number) => L + plotW * Math.min(pos, len) / len;
  const out: string[] = [];

  // the codon axis, on top as the portal puts it when two groups are drawn
  const axY = AX_Y;
  const xs = linear(0, len, L, L + plotW, { nice: false, count: Math.max(2, Math.floor(plotW / 90)) });
  const endText = fmtInt(len) + "aa", endW = textWidth(endText, FS.small);
  xs.ticks = [...xs.ticks.filter((t) => t < len && xs(t) + textWidth(fmtInt(t), FS.small) / 2 + 8 < x(len) - endW), len];
  out.push(axisBottom(xs, axY, p, { minX: L - 20, maxX: W - 2, fmt: (t) => t === len ? endText : fmtInt(t) }));

  const topBase = TOP_BASE;
  const geneY = topBase;                                 // the domains' band
  const botBase = geneY + DOMAIN;                        // where the bottom half's stems start
  const yTop = linear(0, max, topBase, topBase - STEM, { nice: false });
  const yBot = linear(0, max, botBase, botBase + STEM, { nice: false });

  // the halves' y axes: 0 and the max labelled, as the portal labels them, and their two-line titles
  const halfAxis = (ys: typeof yTop, i: number) => {
    const xA = L - 6, [a, b] = ys.range;
    const parts = [`<line x1="${xA}" y1="${a}" x2="${xA}" y2="${b}" stroke="${p.muted}" stroke-width="${SW.line}"/>`];
    for (const t of [0, max]) {
      const y = ys(t);
      parts.push(`<line x1="${xA - 3}" y1="${r1(y)}" x2="${xA}" y2="${r1(y)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
      parts.push(label(xA - 5, y + FS.small * 0.35, tick(t), { size: FS.small, fill: p.muted, anchor: "end" }));
    }
    const mid = (a + b) / 2, room = Math.abs(a - b);
    parts.push(label(8 + FS.small, mid, titles[i][0], { size: FS.small, weight: 600, fill: p.ink, anchor: "middle", rotate: -90, maxW: room }));
    parts.push(label(8 + 2 * FS.small + 4, mid, titles[i][1], { size: FS.small, fill: p.muted, anchor: "middle", rotate: -90, maxW: room }));
    return parts.join("");
  };
  out.push(halfAxis(yTop, 0), halfAxis(yBot, 1));

  // the protein: backbone and Pfam domains, between the halves
  out.push(`<rect x="${r1(L)}" y="${r1(geneY + (DOMAIN - BACKBONE) / 2)}" width="${r1(plotW)}" height="${BACKBONE}" fill="${STICK}"/>`);
  for (const d of drawn[0].domains) {
    const dx = x(d.start), dw = Math.max(2, x(d.end) - x(d.start));
    const room = dw - 6, fits = room >= textWidth(d.name.slice(0, 2) + "…", FS.small);
    out.push(`<g><title>${esc(d.name + " (" + d.accession + "): " + d.start + "–" + d.end)}</title>` +
      `<rect x="${r1(dx)}" y="${geneY}" width="${r1(dw)}" height="${DOMAIN}" fill="${d.color}"/>` +
      (fits ? label(dx + dw / 2, geneY + DOMAIN / 2 + FS.small * 0.35, d.name, { size: FS.small, fill: textOn(d.color), anchor: "middle", maxW: room }) : "") + `</g>`);
  }

  // stems: a selected codon's head drawn larger and last, as the portal draws it; each names its half and codon for the app's click
  drawn.forEach((l, i) => {
    const g = m.groups[i], ys = i === 0 ? yTop : yBot, base = i === 0 ? topBase : botBase;
    const order = [...l.positions.filter((q) => !sel.has(q.pos)), ...l.positions.filter((q) => sel.has(q.pos))];
    for (const q of order) {
      const h = heightOf(q.n, g, m.axis), cx = x(q.pos), cy = ys(Math.min(max, h));
      const tip = (pctAxis ? tipPercent(h) + "% (" + fmtInt(q.n) + " mutated of " + fmtInt(g.profiled) + " profiled patients)"
        : fmtInt(q.n) + " mutated of " + fmtInt(g.profiled) + " profiled patients") + " · " + ordinalName(i, g.name) + "\n" +
        "AA Change: " + q.changes.slice(0, 12).map((c) => c.change + (q.changes.length > 1 ? " " + fmtInt(c.n) : "")).join(", ") +
        (q.changes.length > 12 ? " …and " + (q.changes.length - 12) + " more" : "");
      const on = sel.has(q.pos);
      out.push(`<g data-group="${i}" data-codon="${q.pos}"${on ? ' data-selected="1"' : ""}><title>${esc(tip)}</title>` +
        `<line x1="${r1(cx)}" y1="${base}" x2="${r1(cx)}" y2="${r1(cy)}" stroke="${STICK}" stroke-width="${SW.line}"/>` +
        `<circle class="lollipop-head" cx="${r1(cx)}" cy="${r1(cy)}" r="${on ? 5 : 2.8}" fill="${q.color}"${on ? ` stroke="${p.ink}" stroke-width="1"` : ""}/></g>`);
    }
    const lq = l.label && l.positions.find((q) => q.pos === l.label!.pos);
    if (lq) {
      const w = Math.min(textWidth(l.label!.text, FS.small), plotW);
      const lx = Math.max(L + w / 2, Math.min(W - R - w / 2, x(lq.pos)));
      const cy = ys(Math.min(max, heightOf(lq.n, g, m.axis)));
      out.push(label(lx, i === 0 ? cy - 7 : cy + 7 + FS.small, l.label!.text, { size: FS.small, fill: p.ink, anchor: "middle", maxW: plotW }));
    }
  });

  // legend: the classes either half uses, drivers before VUS within a class
  const used = new Set(drawn.flatMap((l) => l.positions.map((q) => q.impact + (q.driver ? ".driver" : ".vus"))));
  const items: LegendItem[] = [];
  for (const k of IMPACT_TYPES) for (const drv of [true, false]) {
    if (!used.has(k + (drv ? ".driver" : ".vus"))) continue;
    items.push({ label: IMPACT_COLORS[k].label + (m.annotated ? (drv ? " (putative driver)" : " (unknown significance)") : ""), color: drv ? IMPACT_COLORS[k].driver : IMPACT_COLORS[k].vus, kind: "dot" });
  }
  const ly = botBase + STEM + LABEL_ROOM + 8;
  const lg = legend(items, L, ly, W - L - R, p, { size: FS.small });
  out.push(lg.svg);
  const top = ly + lg.height + 14;
  const cap = caption(captionText ?? [v.note || "", mutcompareCaption(v)].filter(Boolean).join(" "), W, top - 8, p.muted);
  return frame(W, top - 8 + cap.height + 10, out.join("") + cap.svg, p.bg, false,
    m.gene + " mutations: " + m.groups.map((g, i) => ordinalName(i, g.name)).join(" vs "));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
