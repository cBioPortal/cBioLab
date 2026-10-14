// The figures' type, line and colour steps. Every renderer picks from these; none invents a size,
// a stroke or a grey in between (the figures once used eleven font sizes and seven greys).

/** Font sizes, px at the figure's own scale. Nothing is drawn below MIN. */
export const FS = {
  /** tick labels, counts on marks, captions */
  small: 10,
  /** row and category labels, legend entries, values */
  body: 11,
  /** a panel's or the figure's title */
  title: 12,
} as const;
export const MIN_FS = 9;

/** stroke widths: gridlines and rules, axes and marks, a series' line */
export const SW = { hair: 0.75, line: 1, series: 2 } as const;

/** the one neutral for "other", "not significant", "not profiled" marks */
export const OTHER = "#9aa5ad";

/**
 * Okabe–Ito, colour-blind safe. Past six series a figure does not reuse a colour alone: the
 * seventh onward repeat the hues with a dash pattern (lines) or a hatch-free lighter tint
 * (fills), so every series stays distinguishable and its legend entry shows how.
 */
export const SERIES = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
const DASHES = ["", "6 3", "2 2.5", "9 3 2 3"];

export interface SeriesStyle { color: string; dash: string; tint: number }
/** series `i`'s colour, its line dash ("" for solid) and, for fills, its opacity */
export function seriesStyle(i: number): SeriesStyle {
  const round = Math.floor(i / SERIES.length);
  return { color: SERIES[i % SERIES.length], dash: DASHES[round % DASHES.length], tint: round ? Math.max(0.45, 1 - round * 0.25) : 1 };
}
export const seriesColor = (i: number) => SERIES[i % SERIES.length];

/** ink for text set ON a fill: white on a dark fill, near-black on a light one (WCAG luminance) */
export function textOn(fill: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // contrast against white vs against #16232b; pick the larger
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0655) ? "#ffffff" : "#16232b";
}
