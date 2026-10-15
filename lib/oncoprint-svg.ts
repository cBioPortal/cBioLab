// Server-side SVG renderer for the oncoprint render contract.
// Zero data logic and zero style of its own: cells come from the contract, level of detail
// from lib/oncoprint-lod.ts, every colour, band and label from lib/oncoprint-style.ts.
import type { Contract, Track } from "./types.ts";
import { cellLayers, numericColor, trackCategoryColor, formatGutterPct, truncateLabel, trackLabelText, trackTooltipLines, geneLegend, glyphPresence, resolveStyle, styleForDisplay, PARTIAL_PROFILE_NOTE, type Style } from "./oncoprint-style.ts";
import { aggregate, bucketEdges } from "./oncoprint-lod.ts";

const esc = (s: unknown): string => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** greedy word wrap; SVG has no flow, so a long caption has to be broken here */
function wrap(text: string, perLine: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > perLine) { out.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) out.push(line);
  return out;
}

export function contractToSvg(contract: Contract, width = 1200, style?: Style, physicalWidthIn?: number): string {
  // the figure's own style: an override travels in the contract, so callers need pass nothing
  const S = styleForDisplay(style ?? resolveStyle(contract.display?.style), contract.display);
  const colors = contract.display?.colors;
  const P = S.palette, G = S.geometry;
  const { rowH: ROW_H, rowGap: ROW_GAP, gutter: GUTTER, groupGap: GROUP_GAP, header: HEADER_H } = G;
  const nTracks = contract.tracks.length;
  const catTracks = contract.display?.clinicalLegends === "none" ? [] : contract.tracks.filter((t) =>
    (t.kind === "clinical" && ((t.categories && t.categories.length) || t.numeric)) || t.kind === "heatmap");
  // gene legend, wrapped to the available width; each row is 16 px
  // only the alterations these cells actually carry
  const items: { label: string; color: string; kind: string }[] = geneLegend(S, glyphPresence(contract.tracks as { kind: string; cells: ArrayLike<number> }[], S));
  if (contract.tracks.some((t) => t.kind === "derivedEvent")) items.splice(items.length - 1, 0, { label: "Derived event", color: P.derived, kind: "swatch" });
  const itemW = (label: string): number => 14 + label.length * 6.2 + 16;
  const legendRows: typeof items[] = [[]];
  { let lx = GUTTER; for (const it of items) { if (lx + itemW(it.label) > width - 8 && legendRows[legendRows.length - 1].length) { legendRows.push([]); lx = GUTTER; } legendRows[legendRows.length - 1].push(it); lx += itemW(it.label); } }
  const captionLines = Math.max(1, Math.ceil((70 + (contract.conventions?.annotation || "").length) / Math.max(20, Math.floor((width - GUTTER - 8) / 6.2))));
  const LEGEND_H = 26 + (legendRows.length + captionLines) * 16;
  const height = HEADER_H + nTracks * (ROW_H + ROW_GAP) + LEGEND_H + catTracks.length * 16;
  const plotW = width - GUTTER - (contract.groups.length - 1) * GROUP_GAP - 8;
  const n = contract.columns.length;
  const colW = plotW / n;
  const groupX: number[] = [];
  let gx = GUTTER;
  for (const g of contract.groups) { groupX.push(gx); gx += g.count * colW + GROUP_GAP; }

  const parts: string[] = [];
  // A caller printing to a physical page passes physicalWidthIn: the internal layout stays in
  // the same px units (so nothing else in this function changes), but the root element declares
  // its size in inches with a viewBox tying that back to the px coordinate space, so opening the
  // file in a page-layout tool places it at exactly that width rather than at 1px-per-SVG-unit.
  const svgW = physicalWidthIn != null ? `${r2(physicalWidthIn)}in` : String(width);
  const svgH = physicalWidthIn != null ? `${r2(physicalWidthIn * height / width)}in` : String(height);
  const viewBox = physicalWidthIn != null ? ` viewBox="0 0 ${width} ${height}"` : "";
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}"${viewBox} font-family="IBM Plex Sans,Helvetica,Arial,sans-serif" font-size="11">`);
  parts.push(`<rect width="${width}" height="${height}" fill="${P.paper}"/>`);

  contract.groups.forEach((g, gi: number) => {
    parts.push(`<text x="${groupX[gi]}" y="13" fill="${P.muted}">${esc(g.name)} (${g.count.toLocaleString("en-US")})</text>`);
  });

  const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${fill}"/>`;
  const geneCell = (code: number, x: number, y: number, w: number): void => {
    for (const l of cellLayers(code, S)) {
      if (l.stroke) {
        // an outline, so whatever is underneath still shows (the portal draws mRNA this way)
        const sw = Math.min(l.stroke, w / 2 || l.stroke);
        parts.push(`<rect x="${r2(x + sw / 2)}" y="${r2(y + sw / 2)}" width="${r2(Math.max(0, w - sw))}" height="${r2(ROW_H - sw)}" fill="none" stroke="${l.color}" stroke-width="${r2(sw)}"/>`);
      } else parts.push(rect(x, y + ROW_H * l.band[0], w, ROW_H * (l.band[1] - l.band[0]), l.color));
    }
  };
  // a cell with no value: the portal's no-data glyph, the not-profiled cell's white and midline
  const noData = (x: number, y: number, w: number): void => {
    const [s0, s1] = S.glyph.notProfiled.stripe.band;
    parts.push(rect(x, y, w, ROW_H, S.glyph.notProfiled.fill), rect(x, y + ROW_H * s0, w, ROW_H * (s1 - s0), S.glyph.notProfiled.stripe.color));
  };
  const scratch = new Int32Array(64);
  const fmtNum = (x: number): string | number => Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : Math.round(x * 10) / 10;

  contract.tracks.forEach((t, ti: number) => {
    const y = HEADER_H + ti * (ROW_H + ROW_GAP);
    parts.push(`<text x="4" y="${y + 14}" fill="${P.text}"><title>${esc(trackTooltipLines(t, contract.columns.length, contract.unit).join("\n"))}</title>${esc(trackLabelText(t, S))}</text>`);
    if (t.freqPct != null) parts.push(`<text x="${GUTTER - 8}" y="${y + 14}" fill="${P.muted}" text-anchor="end">${formatGutterPct(t.driverPct, t.freqPct, t.profiled, contract.columns.length)}</text>`);
    contract.groups.forEach((g, gi: number) => {
      const x0 = groupX[gi], pxW = g.count * colW;
      // one rect per column above a pixel per column; otherwise one bucket per pixel
      const edges = colW >= 1 ? null : bucketEdges(g.count, pxW);
      const nb = edges ? edges.length - 1 : g.count;
      for (let b = 0; b < nb; b++) {
        const k0 = edges ? edges[b] : b, k1 = edges ? edges[b + 1] : b + 1;
        const code = edges ? aggregate(t, t.cells, null, g.start + k0, g.start + k1, scratch) : t.cells[g.start + b];
        const x = x0 + k0 * colW, w = Math.max((k1 - k0) * colW, 0.5);
        if (t.kind === "gene") geneCell(code, x, y, w);
        else if (t.kind === "derivedEvent") parts.push(rect(x, y, w, ROW_H, code > 0 ? P.derived : P.unaltered));
        else if (code === -1) noData(x, y, w);
        else if (t.bar) { const bh = ROW_H * code / 255; parts.push(rect(x, y + ROW_H - bh, w, bh, S.glyph.bar.color)); }
        else if (t.numeric) parts.push(rect(x, y, w, ROW_H, numericColor(code, t.center, S)));
        else parts.push(rect(x, y, w, ROW_H, trackCategoryColor(t, code, S, colors)));
      }
    });
  });

  // legend
  let ly = HEADER_H + nTracks * (ROW_H + ROW_GAP) + 14;
  for (const row of legendRows) {
    let lx = GUTTER;
    for (const it of row) {
      if (it.kind === "notProfiled") {
        parts.push(rect(lx, ly - 9, 10, 10, S.glyph.notProfiled.fill));
        // a 10px swatch would thin the cell's line below a pixel; keep it one at least
        const [s0, s1] = S.glyph.notProfiled.stripe.band, sh = Math.max(1, 10 * (s1 - s0));
        parts.push(rect(lx, ly - 4 - sh / 2, 10, sh, it.color));
      } else if (it.kind === "outline") {
        parts.push(rect(lx, ly - 9, 10, 10, S.palette.unaltered));
        parts.push(`<rect x="${lx + 1}" y="${ly - 8}" width="8" height="8" fill="none" stroke="${it.color}" stroke-width="2"/>`);
      } else parts.push(rect(lx, ly - 9, 10, 10, it.color));
      parts.push(`<text x="${lx + 14}" y="${ly}" fill="${P.muted}">${esc(it.label)}</text>`);
      lx += itemW(it.label);
    }
    ly += 16;
  }
  ly -= 16;
  const partial = contract.tracks.some((t) => t.kind === "gene" && t.profiled != null && t.profiled > 0 && t.profiled < contract.columns.length);
  const hidden = contract.stats.hiddenVus;
  const caption = "gene %: driver / any" +
    (hidden != null ? "; " + hidden.toLocaleString("en-US") + " alterations of unknown significance are hidden and are not in the %" : "") +
    (contract.display?.annotate === "none" ? "; no driver calls were made" : "") + (partial ? "; " + PARTIAL_PROFILE_NOTE : "") +
    " — annotation: " + (contract.conventions ? contract.conventions.annotation || "none" : "none");
  // wrap rather than run off the edge: annotation notes name every unsynced study and get long
  const perLine = Math.max(20, Math.floor((width - GUTTER - 8) / 6.2));
  for (const line of wrap(caption, perLine)) { ly += 16; parts.push(`<text x="${GUTTER}" y="${ly}" fill="${P.muted}">${esc(line)}</text>`); }
  // category key per clinical track (colors reference the same categorical cycle as the cells)
  let cy = ly;
  for (const t of catTracks) {
    cy += 16;
    parts.push(`<text x="4" y="${cy}" fill="${P.text}">${esc(truncateLabel(t.label, S))}</text>`);
    let cx = GUTTER;
    if (t.bar) {
      for (let i = 0; i < 4; i++) parts.push(rect(cx + i * 6, cy - 1 - 2.5 * (i + 1), 4, 2.5 * (i + 1), S.glyph.bar.color));
      parts.push(`<text x="${cx + 4 * 6 + 8}" y="${cy}" fill="${P.muted}">${fmtNum(t.min!)} → ${fmtNum(t.max!)}</text>`);
      continue;
    }
    if (t.numeric) {
      for (let i = 0; i < 24; i++) parts.push(rect(cx + i * 4, cy - 9, 4, 10, numericColor(255 * i / 23, t.center, S)));
      parts.push(`<text x="${cx + 24 * 4 + 8}" y="${cy}" fill="${P.muted}">${fmtNum(t.min!)} → ${fmtNum(t.max!)}${t.center != null ? " (0 at white)" : ""}${t.kind === "heatmap" ? " · " + esc(t.profileType) + ", " + esc(t.note || "") : ""}</text>`);
      continue;
    }
    t.categories!.slice(0, 8).forEach((c, i: number) => {
      const name = String(c).length > 20 ? String(c).slice(0, 19) + "…" : String(c);
      parts.push(rect(cx, cy - 9, 10, 10, trackCategoryColor(t, i, S, colors)));
      parts.push(`<text x="${cx + 14}" y="${cy}" fill="${P.muted}">${esc(name)}</text>`);
      cx += 14 + name.length * 6.2 + 16;
    });
    if (t.categories!.length > 8) parts.push(`<text x="${cx}" y="${cy}" fill="${P.muted}">+${t.categories!.length - 8} more</text>`);
    if (t.profiledFor) {
      parts.push(rect(cx, cy - 9, 10, 10, S.glyph.notProfiled.fill), rect(cx, cy - 4.5, 10, 1, S.glyph.notProfiled.stripe.color));
      parts.push(`<text x="${cx + 14}" y="${cy}" fill="${P.muted}">${esc(S.glyph.profiled.no)}</text>`);
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

export type { Track };
