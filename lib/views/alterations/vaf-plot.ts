// The Patient mutation table's VAF plot (PAT-STM-7), the portal's (vafPlot/legacyVAFCode.js
// AlleleFreqPlotMulti): for each sample, a histogram of its mutations' allele frequencies and a
// Gaussian kernel density curve over [-0.1, 1]. Pure: the page draws it and a test reads it.
import { STYLE, type Style } from "../../oncoprint-style.ts";
import { linear } from "../../chart/scale.ts";
import { axisBottom, axisLeft, bottomAxisHeight, leftAxisWidth } from "../../chart/axis.ts";
import { esc } from "../../chart/esc.ts";
import { palette } from "../../svg-kit.ts";

/** the histogram's bin edges: d3's ticks(30) over [-0.1, 1], every 0.05 */
export const VAF_BIN_EDGES = Array.from({ length: 23 }, (_, i) => (-10 + 5 * i) / 100);
/** where the curve is drawn: d3's ticks(100) over [-0.1, 1], every 0.01 */
export const VAF_GRID = Array.from({ length: 111 }, (_, i) => (-10 + i) / 100);
/** the narrowest kernel, so one value (or several equal ones) still draws a peak */
const MIN_BANDWIDTH = 0.01;

/** How many values fall in each bin: [edge, next edge), the last bin closed at 1 (d3.layout.histogram). */
export function vafBins(values: readonly number[]): number[] {
  const e = VAF_BIN_EDGES, counts: number[] = new Array(e.length - 1).fill(0);
  for (const v of values) {
    if (!(v >= e[0] && v <= e[e.length - 1])) continue;
    let j = 0;
    while (j < counts.length - 1 && v >= e[j + 1]) j++;
    counts[j]++;
  }
  return counts;
}

/** Silverman's rule: 1.06 × the population SD × n^(-1/5), at least 0.01; n is the sample's values. */
export function vafBandwidth(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return Math.max(1.06 * sd * n ** (-1 / 5), MIN_BANDWIDTH);
}

/** The density at each point of VAF_GRID: the mean of a Gaussian kernel (SD the bandwidth) over the values. */
export function vafDensity(values: readonly number[]): number[] {
  const h = vafBandwidth(values), c = 1 / (h * Math.sqrt(2 * Math.PI));
  return VAF_GRID.map((z) => values.reduce((s, v) => s + c * Math.exp(-((z - v) ** 2) / (2 * h * h)), 0) / values.length);
}

/** One sample's allele frequencies, with its marker's number and colour. */
export interface VafSample { id: string; label: string; color: string; values: number[] }

/** Whether there is anything to plot: some sample in view has an allele frequency. */
export const hasVafs = (samples: readonly VafSample[]) => samples.some((s) => s.values.length > 0);

export interface VafPlotOptions {
  histogram: boolean; curve: boolean;
  /** one sample alone, as the legend's hovered entry shows it */
  only?: string;
}

/**
 * The plot as SVG markup. The histogram's bars are counts on the left axis (mutation count); the
 * curves have a scale of their own, from the lowest to the highest density of any sample's curve.
 * Bars are faint with several samples, darker with one; the sample a legend entry picks is drawn alone.
 */
export function vafPlotSvg(samples: readonly VafSample[], o: VafPlotOptions, S: Style = STYLE): { svg: string; width: number; height: number } {
  const V = S.vafPlot, pal = palette("light");
  const drawn = samples.filter((s) => s.values.length > 0);
  const bins = drawn.map((s) => vafBins(s.values));
  const curves = drawn.map((s) => vafDensity(s.values));
  const maxCount = Math.max(1, ...bins.flat());
  const ys = curves.flat();
  const yLo = Math.min(...ys), yHi = Math.max(...ys);
  const yTitle = "mutation count", xTitle = "variant allele frequency";
  const count = linear(0, maxCount, V.height, 0, { count: V.yTicks, nice: false });
  const left = leftAxisWidth(count, yTitle);
  const x = linear(VAF_BIN_EDGES[0], 1, left, left + V.width, { count: V.xTicks, nice: false });
  const density = (d: number) => yHi > yLo ? V.height - (d - yLo) / (yHi - yLo) * V.height : V.height;
  const top = V.top, height = top + V.height + bottomAxisHeight(xTitle), width = left + V.width + V.right;
  const out: string[] = [];
  const shown = (s: VafSample) => !o.only || o.only === s.id;
  const barOpacity = o.only ? V.barOpacityPicked : drawn.length > 1 ? V.barOpacityMany : V.barOpacityOne;
  const binW = x(VAF_BIN_EDGES[1]) - x(VAF_BIN_EDGES[0]) - 1;
  if (o.histogram) drawn.forEach((s, i) => {
    if (!shown(s)) return;
    bins[i].forEach((n, j) => {
      if (n === 0) return;
      const h = n / maxCount * V.height;
      out.push(`<rect class="vaf-bar" data-sample="${esc(s.id)}" x="${r2(x(VAF_BIN_EDGES[j]) + 1)}" y="${r2(top + V.height - h)}" width="${r2(binW)}" height="${r2(h)}" fill="${esc(s.color)}" opacity="${barOpacity}"/>`);
    });
  });
  if (o.curve) drawn.forEach((s, i) => {
    if (!shown(s)) return;
    const d = curves[i].map((y, k) => (k ? "L" : "M") + r2(x(VAF_GRID[k])) + "," + r2(top + density(y))).join("");
    out.push(`<path class="vaf-curve" data-sample="${esc(s.id)}" d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="${V.curveWidth}" opacity="${V.curveOpacity}"/>`);
  });
  const countAxis = Object.assign((v: number) => top + count(v), count, { range: [top + V.height, top] as [number, number] });
  const axes = axisLeft(countAxis, left, pal, { title: yTitle, line: true, tickLen: 3 }) +
    axisBottom(x, top + V.height, pal, { title: xTitle, minX: 0, maxX: width });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-test="vaf-plot">${out.join("")}${axes}</svg>`, width, height };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
