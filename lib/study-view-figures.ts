// A Study View chart as a file, as cBioPortal saves its chart's SVG and PDF: a pie with its legend
// below, a histogram as drawn. The rules, case by case with the portal's source lines, are in
// docs/legacy-spec/parity/download-cases.md (FG). Browser-safe; text only, no DOM.
import { esc, FS, SW, textWidth } from "./svg-kit.ts";
import { portalFreq } from "./chart/format.ts";

/** the figures' colours, written as literals so the file reads the same outside the page */
const INK = "#16232b", MUTED = "#5b6b76", LINE = "#dde4e8", BAR = "#0b6478";
const FONT = "'IBM Plex Sans', Arial, sans-serif";

const n2 = (v: number) => String(Math.round(v * 100) / 100);

/** a standalone SVG document of the given size */
function svgDoc(w: number, h: number, body: string): string {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}

export interface PieSlice { value: string; count: number; color: string }

const PIE_R = 70, PAD = 8, SWATCH = 10, ROW = 16;

/** the pie, then its legend below: the title and "<value>: <count> (<share>)" per slice */
export function pieFigureSvg(title: string, slices: PieSlice[]): string {
  const total = slices.reduce((n, s) => n + s.count, 0);
  const entries = slices.map((s) => s.value + ": " + s.count + " (" + portalFreq(total ? 100 * s.count / total : NaN) + ")");
  const legendW = Math.max(textWidth(title, FS.title, 600), ...entries.map((e) => SWATCH + 6 + textWidth(e, FS.body)), 0);
  const pieW = 2 * PIE_R;
  const w = Math.max(pieW, legendW) + 2 * PAD;
  const pieX = (w - pieW) / 2, legendX = (w - legendW) / 2;
  const cx = pieX + PIE_R, cy = PAD + PIE_R;
  let acc = 0, marks = "";
  for (const s of slices) {
    if (!(s.count > 0) || !(total > 0)) continue;
    const frac = s.count / total;
    if (frac >= 0.999999) { marks += `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${PIE_R}" fill="${esc(s.color)}"/>`; acc += frac; continue; }
    const a0 = acc * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const p = (a: number) => n2(cx + PIE_R * Math.cos(a)) + " " + n2(cy + PIE_R * Math.sin(a));
    marks += `<path d="M ${n2(cx)} ${n2(cy)} L ${p(a0)} A ${PIE_R} ${PIE_R} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(a1)} Z" fill="${esc(s.color)}" stroke="#ffffff" stroke-width="${SW.hair}"/>`;
  }
  let y = PAD + pieW + PAD + FS.title;
  let legend = `<text x="${n2(legendX)}" y="${n2(y)}" font-size="${FS.title}" font-weight="600" fill="${INK}">${esc(title)}</text>`;
  slices.forEach((s, i) => {
    y += ROW;
    legend += `<rect x="${n2(legendX)}" y="${n2(y - SWATCH + 1)}" width="${SWATCH}" height="${SWATCH}" fill="${esc(s.color)}"/>` +
      `<text x="${n2(legendX + SWATCH + 6)}" y="${n2(y)}" font-size="${FS.body}" fill="${INK}">${esc(entries[i])}</text>`;
  });
  return svgDoc(w, y + PAD, marks + legend);
}

/** a bar; `na` marks the NA bar, drawn as the others are */
export interface FigureBar { count: number; tick: string; na?: boolean }

/** a histogram as drawn: bar heights by count over the largest, at least 2% of the plot */
export function barFigureSvg(bars: FigureBar[], o: { width?: number; height?: number; naNote?: string } = {}): string {
  const plotH = o.height ?? 120;
  const noteW = o.naNote ? textWidth(o.naNote, FS.small) + 8 : 0;
  const w = Math.max(o.width ?? 300, noteW + 4 * Math.max(1, bars.length) + 2 * PAD);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const slot = (w - 2 * PAD - noteW) / Math.max(1, bars.length), gap = Math.min(2, slot / 4);
  const top = PAD, base = top + plotH;
  let body = `<line x1="${PAD}" y1="${n2(base)}" x2="${n2(w - PAD - noteW)}" y2="${n2(base)}" stroke="${LINE}" stroke-width="${SW.line}"/>`;
  bars.forEach((b, i) => {
    const h = Math.max(0.02 * plotH, plotH * Math.max(0, b.count) / max);
    const x = PAD + i * slot + gap / 2;
    body += `<rect x="${n2(x)}" y="${n2(base - h)}" width="${n2(Math.max(0.5, slot - gap))}" height="${n2(h)}" fill="${BAR}" fill-opacity="0.72"/>`;
    if (b.tick) body += `<text x="${n2(x)}" y="${n2(base + FS.small + 3)}" font-size="${FS.small}" fill="${MUTED}">${esc(b.tick)}</text>`;
  });
  if (o.naNote) body += `<text x="${n2(w - PAD - noteW + 6)}" y="${n2(base)}" font-size="${FS.small}" fill="${MUTED}">${esc(o.naNote)}</text>`;
  return svgDoc(w, base + FS.small + 3 + PAD, body);
}
