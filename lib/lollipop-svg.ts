// The lollipop figure: the plot alone, one panel per gene, and its caption's words for what the app
// shows beside it as controls. Imports only the drawing kit and lib/lollipop.ts, so the app draws
// it in the browser (app/_lollipop/HotspotsBody.tsx) from the same code the server uses for MCP.
import { IMPACT_COLORS, IMPACT_TYPES, filterHotspotGene, cellLabel, type AlterationCell } from "./lollipop.ts";
import type { HotspotGene } from "./types.ts";
import {
  esc, palette, frame, caption, linear, axisLeft, axisBottom, leftAxisWidth, legend, label, textWidth, textOn,
  fmtInt, fmtShare, FS, SW, type SvgOpts, type LegendItem
} from "./svg-kit.ts";

/**
 * What the grid beside a lollipop shows in the app — somatic mutation frequency and the Driver/VUS
 * counts by alteration class — in words, plus what the selection hides, for a figure that travels
 * without the app (an MCP client's image, an export). The app draws those as controls instead.
 */
export function lollipopSummaryText(genes: HotspotGene[], hide: readonly string[]): string {
  const parts = genes.map((g) => {
    const freq = g.cohortSamples ? fmtShare(g.somaticSamples / g.cohortSamples) : "–";
    const cells = IMPACT_TYPES.filter((k) => g.tally[k].driver || g.tally[k].vus)
      .map((k) => IMPACT_COLORS[k].label.toLowerCase() + " " + fmtInt(g.tally[k].driver) + " driver / " + fmtInt(g.tally[k].vus) + " VUS");
    const f = filterHotspotGene(g, hide);
    return g.gene + ": somatic mutation frequency " + freq + "; mutation rows " + (cells.join(", ") || "none") +
      (hide.length ? "; drawn: " + fmtInt(f.shown) + " of " + fmtInt(f.total) + " mutations" +
        (f.unclassed ? " (" + fmtInt(f.unclassed) + " from a site that reports no alteration class, drawn regardless)" : "") : "") + ".";
  });
  return (hide.length ? "Hidden: " + hide.map((c) => cellLabel(c as AlterationCell)).join(", ") + ". " : "") + parts.join(" ");
}

/**
 * The lollipop, drawn as cBioPortal's results-page mutation tab draws it (react-mutation-mapper's
 * LollipopPlotNoTooltip / LollipopMutationPlot): a protein backbone with its Pfam domains, one
 * grey stem per codon topped by a 2.8px head in the codon's colour, a linear y axis of
 * "# GENE Mutations" whose max is at least 5, and one label on the tallest stem. What the rules
 * decide lives in lib/lollipop.ts; this only places it, at the width it is given. The plots alone,
 * one panel per gene, with a caption: the app draws its own controls beside them, and
 * lib/view-svg.ts's hotspotsSvg wraps them for a figure that stands alone.
 */
export function lollipopPanelsSvg(genes: HotspotGene[], o: SvgOpts, captionText: string): string {
  const p = palette(o.theme), W = Math.max(400, o.width || 720);
  const R = 16, STEM = 150, LABEL_ROOM = 18, BACKBONE = 14, DOMAIN = 24, STICK = "#BABDB6";
  const out: string[] = [];
  let top = 6;
  for (const g of genes) {
    const len = Math.max(1, g.proteinLength);
    const maxN = Math.max(0, ...g.positions.map((q) => q.n));
    const yTitle = "# " + g.gene + " Mutations";
    const head = 18, yTop = top + head + LABEL_ROOM, yBase = yTop + STEM;
    const ys = linear(0, Math.max(5, maxN), yBase, yTop, { count: 4 });
    const yFmt = (t: number) => fmtInt(t);
    const L = 8 + leftAxisWidth(ys, yTitle, yFmt);
    const plotW = W - L - R;
    const x = (pos: number) => L + plotW * Math.min(pos, len) / len;

    const gw = textWidth(g.gene, FS.title, 600);
    out.push(label(8, top + 13, g.gene, { size: FS.title, weight: 600, fill: p.ink }));
    out.push(label(8 + gw + 10, top + 13, fmtInt(g.mutations) + " mutations · " + fmtInt(g.mutated) + " mutated patients" +
      (g.lengthSource === "genome-nexus" ? "" : " · length unknown — axis runs to codon " + fmtInt(len)), { size: FS.small, fill: p.muted, maxW: W - 8 - gw - 10 - 8 }));
    out.push(axisLeft(ys, L - 6, p, { title: yTitle, gridTo: W - R, fmt: yFmt, line: true }));

    // backbone and domains, each named where its name fits (cut with its full name kept), always in its tooltip
    const bbY = yBase + (DOMAIN - BACKBONE) / 2;
    out.push(`<rect x="${r1(L)}" y="${r1(bbY)}" width="${r1(plotW)}" height="${BACKBONE}" fill="${STICK}"/>`);
    for (const d of g.domains) {
      const dx = x(d.start), dw = Math.max(2, x(d.end) - x(d.start));
      const room = dw - 6, fits = room >= textWidth(d.name.slice(0, 2) + "…", FS.small);
      out.push(`<g><title>${esc(d.name + " (" + d.accession + "): " + d.start + "–" + d.end)}</title>` +
        `<rect x="${r1(dx)}" y="${yBase}" width="${r1(dw)}" height="${DOMAIN}" fill="${d.color}"/>` +
        (fits ? label(dx + dw / 2, yBase + DOMAIN / 2 + FS.small * 0.35, d.name, { size: FS.small, fill: textOn(d.color), anchor: "middle", maxW: room }) : "") + `</g>`);
    }

    // x axis: round codon steps, and the protein's length at its end in place of any tick it would touch
    const axY = yBase + DOMAIN + 4;
    const xs = linear(0, len, L, L + plotW, { nice: false, count: Math.max(2, Math.floor(plotW / 90)) });
    const endText = fmtInt(len) + "aa", endW = textWidth(endText, FS.small);
    xs.ticks = [...xs.ticks.filter((t) => t < len && xs(t) + textWidth(fmtInt(t), FS.small) / 2 + 8 < x(len) - endW), len];
    out.push(axisBottom(xs, axY, p, { minX: L - 20, maxX: W - 2, fmt: (t) => t === len ? endText : fmtInt(t) }));

    // stems, heads, tooltips
    for (const q of g.positions) {
      const cx = x(q.pos), cy = ys(Math.min(ys.domain[1], q.n));
      const tip = "codon " + q.pos + ": " + fmtInt(q.n) + " mutation" + (q.n === 1 ? "" : "s") + "\n" +
        q.changes.slice(0, 12).map((c) => c.change + " " + fmtInt(c.n)).join("\n") +
        (q.changes.length > 12 ? "\n…and " + (q.changes.length - 12) + " more" : "");
      out.push(`<g><title>${esc(tip)}</title>` +
        `<line x1="${r1(cx)}" y1="${yBase}" x2="${r1(cx)}" y2="${r1(cy)}" stroke="${STICK}" stroke-width="${SW.line}"/>` +
        `<circle class="lollipop-head" cx="${r1(cx)}" cy="${r1(cy)}" r="2.8" fill="${q.color}"/></g>`);
    }
    if (g.label) {
      const lq = g.positions.find((q) => q.pos === g.label!.pos);
      if (lq) {
        const w = Math.min(textWidth(g.label.text, FS.small), plotW);
        const lx = Math.max(L + w / 2, Math.min(W - R - w / 2, x(lq.pos)));
        out.push(label(lx, ys(Math.min(ys.domain[1], lq.n)) - 7, g.label.text, { size: FS.small, fill: p.ink, anchor: "middle", maxW: plotW }));
      }
    }

    // legend: the classes this gene uses, always in the same order (drivers before VUS within a class)
    const used = new Set(g.positions.map((q) => q.impact + (q.driver ? ".driver" : ".vus")));
    const items: LegendItem[] = [];
    for (const k of IMPACT_TYPES) for (const drv of [true, false]) {
      if (!used.has(k + (drv ? ".driver" : ".vus"))) continue;
      items.push({ label: IMPACT_COLORS[k].label + (drv ? "" : " (VUS)"), color: drv ? IMPACT_COLORS[k].driver : IMPACT_COLORS[k].vus, kind: "dot" });
    }
    const ly = axY + 6 + FS.small + 8;
    const lg = legend(items, L, ly, W - L - R, p, { size: FS.small });
    out.push(lg.svg);
    top = ly + lg.height + 14;
  }
  const cap = caption(captionText, W, top - 8, p.muted);
  return frame(W, top - 8 + cap.height + 10, out.join("") + cap.svg, p.bg, false, "Mutations by protein position — " + genes.map((g) => g.gene).join(", "));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
