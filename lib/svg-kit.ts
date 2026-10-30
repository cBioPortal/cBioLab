// The frame every server-rendered figure shares: palette, number formats, the
// outer <svg> and the wrapped caption. lib/view-svg.ts and lib/figures/
// both draw through these, so a new view kind cannot drift from the others'
// colours or type.
// The layout pieces (measured text, scales and ticks, axes, legends, number formats, type and
// stroke steps) live in lib/chart/ and are re-exported here, so a figure imports one module.
import { esc } from "./chart/esc.ts";
import { wrapWidth } from "./chart/text.ts";
import { FS } from "./chart/style.ts";
import { fmtP } from "./chart/format.ts";
export { esc };
export { SERIES, seriesStyle, seriesColor, textOn, FS, MIN_FS, SW, OTHER } from "./chart/style.ts";
export { textWidth, ellipsize, wrapWidth, label, packLines, paragraph } from "./chart/text.ts";
export { fmtInt, fmtNum, fmtPct, fmtShare, fmtP, fmtQ, pDigits, fmtRatio, fmtMonths, fmtCI, tickFormat } from "./chart/format.ts";
export { linear, log, symlog, type Scale } from "./chart/scale.ts";
export { axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, bandLabels } from "./chart/axis.ts";
export { legend, lineSwatch, type LegendItem } from "./chart/legend.ts";
export { timeScale, timeTitle } from "./chart/time.ts";
export { placeLabels, type LabelWant, type Placed } from "./chart/place.ts";
export { stepPath, r1 } from "./chart/marks.ts";

export const INK = "var(--ink, #16232b)";
export const MUTED = "var(--muted, #5b6b76)";
export const LINE = "var(--line, #dde4e8)";
export const BG = "var(--bg, #ffffff)";

export interface SvgOpts {
  /** the width to lay the figure out at: the container's, measured, in the page */
  width?: number;
  theme?: "auto" | "light";
}

/** Palette resolution: "light" bakes literals in, for rasterising outside the app. */
export function palette(theme: SvgOpts["theme"]) {
  return theme === "light"
    ? { ink: "#16232b", muted: "#5b6b76", line: "#dde4e8", bg: "#ffffff" }
    : { ink: INK, muted: MUTED, line: LINE, bg: BG };
}

export const num = (n: number): string => (Math.round(n * 100) / 100).toString();
export const fmt = (n: number): string => n.toLocaleString("en-US");
export const pFmt = (p: number): string => fmtP(p);

/**
 * `grown`: the renderer widened the figure past the width it was asked for, to fit every group
 * or category rather than drop some. Such a figure must not be scaled back down to the
 * container (every label would shrink below legibility), so it keeps its width as a minimum and
 * the container scrolls. A figure at its requested width still scales to fit, as before.
 */
export function frame(w: number, h: number, body: string, bg: string, grown = false, title?: string, opts: { tip?: boolean } = {}): string {
  w = Math.ceil(w); h = Math.ceil(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img"` +
    (title ? ` aria-label="${esc(title)}"` : "") +
    // `tip: false`: the title names the figure (aria-label) but is not shown on hovering it — no
    // <title>, which the browser would show as its own tooltip, and an empty data-tip, which
    // app/_ui/tooltip.tsx reads as "no tip here" — for a figure whose page shows its marks' tips
    (opts.tip === false ? ` data-tip=""` : "") +
    ` style="max-width:${w}px;${grown ? `min-width:${w}px;` : ""}height:auto;display:block;font-family:'IBM Plex Sans',system-ui,sans-serif">` +
    (title && opts.tip !== false ? `<title>${esc(title)}</title>` : "") +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

/** the widest a caption's lines run, however wide the figure: a line much longer is hard to read */
const CAPTION_MEASURE = 760;

/** Wrapped caption lines — the caveat travels WITH the figure, never separately. Wrapped to the
 *  figure's width as measured, so a caption neither overruns the edge nor leaves half of it empty. */
export function caption(text: string, w: number, y0: number, muted: string): { svg: string; height: number } {
  if (!String(text).trim()) return { svg: "", height: 0 };
  const lines = wrapWidth(text, Math.min(w - 16, CAPTION_MEASURE), FS.small);
  const lh = Math.round(FS.small * 1.35);
  return {
    svg: lines.map((l, i) => `<text x="8" y="${y0 + 12 + i * lh}" font-size="${FS.small}" fill="${muted}">${esc(l)}</text>`).join(""),
    height: lines.length * lh + 8
  };
}

