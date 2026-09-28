// The frame every server-rendered figure shares: palette, number formats, the
// outer <svg> and the wrapped caption. lib/view-svg.ts and lib/view-svg-more.ts
// both draw through these, so a new view kind cannot drift from the others'
// colours or type.
/** Cohort names and data values reach <text>; they must never reach it raw. */
export const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SERIES = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
export const INK = "var(--ink, #16232b)";
export const MUTED = "var(--muted, #5b6b76)";
export const LINE = "var(--line, #dde4e8)";
export const BG = "var(--bg, #ffffff)";

export interface SvgOpts { width?: number; theme?: "auto" | "light" }

/** Palette resolution: "light" bakes literals in, for rasterising outside the app. */
export function palette(theme: SvgOpts["theme"]) {
  return theme === "light"
    ? { ink: "#16232b", muted: "#5b6b76", line: "#dde4e8", bg: "#ffffff" }
    : { ink: INK, muted: MUTED, line: LINE, bg: BG };
}

export const num = (n: number): string => (Math.round(n * 100) / 100).toString();
export const fmt = (n: number): string => n.toLocaleString("en-US");
export const pFmt = (p: number): string => p === 0 ? "p < 1e-300" : p < 1e-4 ? "p=" + p.toExponential(1) : "p=" + p.toFixed(4);

/**
 * `grown`: the renderer widened the figure past the width it was asked for, to fit every group
 * or category rather than drop some. Such a figure must not be scaled back down to the
 * container (every label would shrink below legibility), so it keeps its width as a minimum and
 * the container scrolls. A figure at its requested width still scales to fit, as before.
 */
export function frame(w: number, h: number, body: string, bg: string, grown = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" ` +
    `style="max-width:${w}px;${grown ? `min-width:${w}px;` : ""}height:auto;display:block;font-family:'IBM Plex Sans',system-ui,sans-serif">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

/** Wrapped caption lines — the caveat travels WITH the figure, never separately. */
export function caption(text: string, w: number, y0: number, muted: string, perLine = 96): { svg: string; height: number } {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > perLine) { lines.push(line.trim()); line = word; }
    else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  return {
    svg: lines.map((l, i) => `<text x="8" y="${y0 + 12 + i * 13}" font-size="10" fill="${muted}">${esc(l)}</text>`).join(""),
    height: lines.length * 13 + 8
  };
}

