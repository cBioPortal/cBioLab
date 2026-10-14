// One legend for every figure: entries flow left to right and wrap at the figure's width, each
// measured, each with the swatch its marks use (a filled square, or a line with the series' dash).
import { textWidth, label } from "./text.ts";
import { esc } from "./esc.ts";
import { FS, SW } from "./style.ts";

export interface LegendItem {
  label: string;
  color: string;
  /** "line" draws the series' stroke (with `dash`), "dot" a circle; default a filled square */
  kind?: "rect" | "line" | "dot";
  dash?: string;
  opacity?: number;
  /** muted text after the label, e.g. "median 37.2 mo · n = 6,322" */
  detail?: string;
}

const SW_W = { rect: 10, dot: 10, line: 18 };
const GAP = 5, ITEM_GAP = 16;

/**
 * Legend entries laid out from (x, y) within `maxW`; `y` is the top of the first row. Entries flow
 * and wrap; with `grid` they sit in equal columns (as many as the widest entry allows), which reads
 * better for many entries carrying detail text. An entry wider than its room is cut, its full text
 * kept as a tooltip. Returns the drawing and its height.
 */
export function legend(items: LegendItem[], x: number, y: number, maxW: number, pal: { ink: string; muted: string },
  o: { grid?: boolean; size?: number; title?: string } = {}): { svg: string; height: number } {
  const size = o.size ?? FS.body, rowH = Math.round(size * 1.65);
  const out: string[] = [];
  let x0 = x, room = maxW;
  if (o.title) {
    out.push(label(x, y + rowH / 2 - 1 + size * 0.35, o.title, { size, fill: pal.muted, maxW: maxW * 0.3 }));
    const tw = Math.min(maxW * 0.3, textWidth(o.title, size)) + 10;
    x0 = x + tw; room = maxW - tw;
  }
  const widthOf = (it: LegendItem) => SW_W[it.kind || "rect"] + GAP + textWidth(it.label, size) + (it.detail ? (textWidth(it.detail, size) + 6) : 0);
  const cols = o.grid ? Math.max(1, Math.min(items.length, Math.floor((room + ITEM_GAP) / (Math.max(...items.map(widthOf), 1) + ITEM_GAP)))) : 0;
  const cellW = cols ? (room - ITEM_GAP * (cols - 1)) / cols : 0;
  let cx = x0, cy = y;
  items.forEach((it, i) => {
    const kind = it.kind || "rect", sw = SW_W[kind];
    let w = widthOf(it);
    if (cols) {
      cx = x0 + (i % cols) * (cellW + ITEM_GAP); cy = y + Math.floor(i / cols) * rowH; w = Math.min(w, cellW);
    } else if (cx > x0 && cx + w > x0 + room) { cx = x0; cy += rowH; }
    const mid = cy + rowH / 2 - 1;
    const op = it.opacity != null && it.opacity < 1 ? ` opacity="${it.opacity}"` : "";
    if (kind === "line")
      out.push(`<line x1="${cx}" y1="${mid}" x2="${cx + sw}" y2="${mid}" stroke="${it.color}" stroke-width="${SW.series}"${it.dash ? ` stroke-dasharray="${it.dash}"` : ""}${op}/>`);
    else if (kind === "dot")
      out.push(`<circle cx="${cx + sw / 2}" cy="${mid}" r="${sw / 2 - 1}" fill="${it.color}"${op}/>`);
    else
      out.push(`<rect x="${cx}" y="${mid - sw / 2}" width="${sw}" height="${sw}" rx="2" fill="${it.color}"${op}/>`);
    const tx = cx + sw + GAP, avail = (cols ? cx + cellW : x0 + room) - tx;
    const ty = mid + size * 0.35;
    const main = textWidth(it.label, size), det = it.detail ? (textWidth(it.detail, size) + 6) : 0;
    if (it.detail && main + det <= avail) {
      out.push(`<text x="${r1(tx)}" y="${r1(ty)}" font-size="${size}" fill="${pal.ink}">${esc(it.label)}<tspan dx="6" fill="${pal.muted}">${esc(it.detail)}</tspan></text>`);
    } else {
      out.push(label(tx, ty, it.detail ? it.label + " · " + it.detail : it.label, { size, fill: pal.ink, maxW: avail }));
    }
    if (!cols) cx += Math.min(w, x0 + room - cx) + ITEM_GAP;
  });
  return { svg: out.join(""), height: (items.length ? cy - y + rowH : 0) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** a series' line swatch (its colour and dash), 18 px wide, centred on y */
export function lineSwatch(x: number, y: number, color: string, dash: string, width = 2): string {
  return `<line x1="${x}" y1="${r1(y)}" x2="${x + 18}" y2="${r1(y)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}
