// The lollipop figure: the plot alone, one panel per gene, and its caption's words for what the app
// shows beside it as controls. Imports only the drawing kit and lib/lollipop.ts, so the app draws
// it in the browser (app/_lollipop/HotspotsBody.tsx) from the same code the server uses for MCP.
import { IMPACT_COLORS, IMPACT_TYPES, filterHotspotGene, cellLabel, type AlterationCell } from "./lollipop.ts";
import type { HotspotGene } from "./types.ts";
import { esc, palette, num, fmt, frame, caption, type SvgOpts } from "./svg-kit.ts";

/**
 * What the grid beside a lollipop shows in the app — somatic mutation frequency and the Driver/VUS
 * counts by alteration class — in words, plus what the selection hides, for a figure that travels
 * without the app (an MCP client's image, an export). The app draws those as controls instead.
 */
export function lollipopSummaryText(genes: HotspotGene[], hide: readonly string[]): string {
  const parts = genes.map((g) => {
    const freq = g.cohortSamples ? (Math.round(1000 * g.somaticSamples / g.cohortSamples) / 10).toFixed(1) + "%" : "—";
    const cells = IMPACT_TYPES.filter((k) => g.tally[k].driver || g.tally[k].vus)
      .map((k) => IMPACT_COLORS[k].label.toLowerCase() + " " + fmt(g.tally[k].driver) + " driver / " + fmt(g.tally[k].vus) + " VUS");
    const f = filterHotspotGene(g, hide);
    return g.gene + ": somatic mutation frequency " + freq + "; mutation rows " + (cells.join(", ") || "none") +
      (hide.length ? "; drawn: " + fmt(f.shown) + " of " + fmt(f.total) + " mutations" +
        (f.unclassed ? " (" + fmt(f.unclassed) + " from a site that reports no alteration class, drawn regardless)" : "") : "") + ".";
  });
  return (hide.length ? "Hidden: " + hide.map((c) => cellLabel(c as AlterationCell)).join(", ") + ". " : "") + parts.join(" ");
}

/**
 * The lollipop, drawn as cBioPortal's results-page mutation tab draws it (react-mutation-mapper's
 * LollipopPlotNoTooltip / LollipopMutationPlot): a protein backbone with its Pfam domains, one
 * grey stem per codon topped by a 2.8px head in the codon's colour, a linear y axis of
 * "# GENE Mutations" whose max is at least 5, and one label on the tallest stem. What the rules
 * decide lives in lib/lollipop.ts; this only places it. The plots alone, one panel per gene, with a
 * caption: the app draws its own controls beside them, and lib/view-svg.ts's hotspotsSvg wraps them
 * for a figure that stands alone.
 */
export function lollipopPanelsSvg(genes: HotspotGene[], o: SvgOpts, captionText: string): string {
  const p = palette(o.theme), W = o.width || 720;
  const L = 56, R = 16, plotW = W - L - R;
  const STEM = 160, LABEL_ROOM = 20, BACKBONE = 14, DOMAIN = 24, STICK = "#BABDB6";
  const PANEL = 22 + LABEL_ROOM + STEM + DOMAIN + 40 + 18;
  const out: string[] = [];
  genes.forEach((g, gi) => {
    const top = 8 + gi * PANEL;
    const len = Math.max(1, g.proteinLength);
    const x = (pos: number) => L + plotW * Math.min(pos, len) / len;
    const yTop = top + 22 + LABEL_ROOM, yBase = yTop + STEM;
    const maxN = Math.max(0, ...g.positions.map((q) => q.n));
    const yMax = Math.max(5, maxN);
    out.push(`<text x="8" y="${top + 12}" font-size="12" font-weight="600" fill="${p.ink}">${esc(g.gene)}</text>` +
      `<text x="${8 + g.gene.length * 8 + 10}" y="${top + 12}" font-size="10" fill="${p.muted}">` +
      esc(fmt(g.mutations) + " mutations · " + fmt(g.mutated) + " mutated patients" +
        (g.lengthSource === "genome-nexus" ? "" : " · length unknown — axis runs to codon " + len)) + `</text>`);

    // y axis: ticks at 0 and max labelled; unlabelled ones between at the first step giving < 9 intervals
    const stepY = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((st) => yMax / st < 9) ?? Math.ceil(yMax / 8);
    const yAt = (n: number) => yBase - STEM * Math.min(1, n / yMax);
    out.push(`<line x1="${L - 6}" y1="${yTop}" x2="${L - 6}" y2="${yBase}" stroke="${p.muted}" stroke-width="1"/>`);
    for (let t = 0; t <= yMax; t += stepY) out.push(`<line x1="${L - 10}" y1="${num(yAt(t))}" x2="${L - 6}" y2="${num(yAt(t))}" stroke="${p.muted}"/>`);
    out.push(`<text x="${L - 12}" y="${num(yAt(0) + 3)}" font-size="10" fill="${p.muted}" text-anchor="end">0</text>`,
      `<text x="${L - 12}" y="${num(yAt(yMax) + 3)}" font-size="10" fill="${p.muted}" text-anchor="end">${fmt(yMax)}</text>`,
      `<text x="14" y="${num((yTop + yBase) / 2)}" font-size="10" fill="${p.muted}" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${num((yTop + yBase) / 2)})"># ${esc(g.gene)} Mutations</text>`);

    // backbone and domains
    const bbY = yBase + (DOMAIN - BACKBONE) / 2;
    out.push(`<rect x="${L}" y="${num(bbY)}" width="${num(plotW)}" height="${BACKBONE}" fill="${STICK}"/>`);
    for (const d of g.domains) {
      const dx = x(d.start), dw = Math.max(2, x(d.end) - x(d.start));
      const fit = Math.floor(dw / 6);
      const name = d.name.length <= fit ? d.name : fit > 2 ? d.name.slice(0, fit - 2) + ".." : "";
      out.push(`<g><title>${esc(d.name + " (" + d.accession + "): " + d.start + "–" + d.end)}</title>` +
        `<rect x="${num(dx)}" y="${yBase}" width="${num(dw)}" height="${DOMAIN}" fill="${d.color}"/>` +
        (name ? `<text x="${num(dx + dw / 2)}" y="${yBase + DOMAIN / 2 + 3.5}" font-size="10" fill="#ffffff" text-anchor="middle">${esc(name)}</text>` : "") + `</g>`);
    }

    // x axis: ticks at the first interval giving < 15, labels at even multiples, 0 and "<len>aa" always
    const stepX = [50, 100, 200, 250, 500, 1000, 2500, 5000, 10000, 25000].find((st) => len / st < 15) ?? 50000;
    const axY = yBase + DOMAIN + 6;
    const tick = (pos: number, label: string | null) => out.push(`<line x1="${num(x(pos))}" y1="${axY}" x2="${num(x(pos))}" y2="${axY + 4}" stroke="${p.muted}"/>` +
      (label != null ? `<text x="${num(x(pos))}" y="${axY + 15}" font-size="10" fill="${p.muted}" text-anchor="middle">${label}</text>` : ""));
    tick(0, "0");
    for (let t = stepX, k = 1; t < len; t += stepX, k++) tick(t, k % 2 === 0 && len - t > (2 / 3) * stepX ? String(t) : null);
    tick(len, len + "aa");

    // stems, heads, tooltips
    for (const q of g.positions) {
      const cx = x(q.pos), cy = yAt(q.n);
      const tip = "codon " + q.pos + ": " + fmt(q.n) + " mutation" + (q.n === 1 ? "" : "s") + "\n" +
        q.changes.slice(0, 12).map((c) => c.change + " " + fmt(c.n)).join("\n") +
        (q.changes.length > 12 ? "\n…and " + (q.changes.length - 12) + " more" : "");
      out.push(`<g><title>${esc(tip)}</title>` +
        `<line x1="${num(cx)}" y1="${yBase}" x2="${num(cx)}" y2="${num(cy)}" stroke="${STICK}" stroke-width="1"/>` +
        `<circle class="lollipop-head" cx="${num(cx)}" cy="${num(cy)}" r="2.8" fill="${q.color}"/></g>`);
    }
    if (g.label) {
      const lq = g.positions.find((q) => q.pos === g.label!.pos);
      if (lq) {
        const lx = x(lq.pos), half = g.label.text.length * 2.9;
        const anchor = lx - half < L ? "start" : lx + half > W - R ? "end" : "middle";
        out.push(`<text x="${num(lx)}" y="${num(yAt(lq.n) - 7)}" font-size="10" font-family="Arial,sans-serif" fill="${p.ink}" text-anchor="${anchor}">${esc(g.label.text)}</text>`);
      }
    }

    // legend: the colours this gene actually uses
    const used = new Map<string, string>();
    for (const q of g.positions) used.set(q.color, (IMPACT_COLORS as any)[q.impact].label + (q.driver ? "" : " (VUS)"));
    let lx = L;
    const ly = axY + 32;
    for (const [color, label] of used) {
      out.push(`<circle cx="${lx + 4}" cy="${ly - 3}" r="3.5" fill="${color}"/><text x="${lx + 11}" y="${ly}" font-size="9" fill="${p.muted}">${esc(label)}</text>`);
      lx += 22 + label.length * 5.4;
    }
  });
  const H = 8 + genes.length * PANEL;
  const cap = caption(captionText, W, H, p.muted);
  return frame(W, H + cap.height + 10, out.join("") + cap.svg, p.bg);
}

