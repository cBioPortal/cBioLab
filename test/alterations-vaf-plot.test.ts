// The Patient mutation table's VAF plot (PAT-STM-7), from the portal's vafPlot/legacyVAFCode.js
// (AlleleFreqPlotMulti, AlleleFreqPlotUtils) and GenomicOverviewUtils computeMutationFrequencyBySample:
//   B  histogram: d3.layout.histogram().bins(x.ticks(30)) over x's domain [-0.1, 1]: edges every 0.05, a value
//      on an edge in the bin above it, 1 in the last bin
//   K  density: x.ticks(100) (every 0.01), each point the mean of a Gaussian kernel over the sample's values,
//      SD = max(1.06 × population SD × n^(-1/5), 0.01); n is the sample's values (the portal's NaN padding
//      counted in n is a legacy bug, not copied)
//   Y  the left axis counts mutations, 0 to the fullest bin of any sample; bars drawn on it
//   O  bars 0.1 opaque with several samples in view, 0.3 with one — every sample counted, with frequencies or not
//      (computeMutationFrequencyBySample pads each sample of sampleOrder; Object.keys(data).length); a legend
//      entry's sample alone, its bars 0.5
//   E  a sample with no allele frequency draws nothing; with none in view there is no plot (the portal
//      checks only the first sample's first value, a legacy bug, not copied)
// Expected densities were worked out apart from the code (Python, the formula above).
import { test } from "node:test";
import assert from "node:assert/strict";
import { VAF_BIN_EDGES, VAF_GRID, hasVafs, vafBandwidth, vafBins, vafDensity, vafPlotSvg as draw, vafSeries } from "../lib/views/alterations/vaf-plot.ts";
import { STYLE } from "../lib/oncoprint-style.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " ≉ " + b);

test("B: 22 bins, edges -0.1 to 1 every 0.05; an edge value in the bin above; 1 in the last", () => {
  assert.equal(VAF_BIN_EDGES.length, 23);
  assert.equal(VAF_BIN_EDGES[0], -0.1); assert.equal(VAF_BIN_EDGES[2], 0); assert.equal(VAF_BIN_EDGES[22], 1);
  const b = vafBins([0, 0.15, 0.1999, 1, 0.99, 38 / 195]);
  assert.equal(b.length, 22);
  assert.equal(b[2], 1, "0 is in [0, 0.05)");
  assert.equal(b[5], 3, "0.15, 0.1999 and 0.1949 are in [0.15, 0.2)");
  assert.equal(b[21], 2, "0.99 and 1 are in [0.95, 1]");
  assert.equal(b.reduce((s, n) => s + n, 0), 6);
  assert.equal(vafBins([1.2, -0.2, NaN]).reduce((s, n) => s + n, 0), 0, "outside the domain, or not a number: in no bin");
});

test("K: the curve's points every 0.01 over [-0.1, 1]; Silverman's bandwidth over the sample's own values", () => {
  assert.equal(VAF_GRID.length, 111); assert.equal(VAF_GRID[0], -0.1); assert.equal(VAF_GRID[60], 0.5); assert.equal(VAF_GRID[110], 1);
  const v = [0.2, 0.4, 0.6, 0.8];
  close(vafBandwidth(v), 0.17962999969901106);
  const d = vafDensity(v);
  close(d[60], 1.2263647354945264); close(d[0], 0.14947406029991814); close(d[110], 0.34738614680369373);
  assert.equal(vafBandwidth([0.5]), 0.01, "one value: the narrowest kernel");
  close(vafDensity([0.5])[60], 39.894228040143275); close(vafDensity([0.5])[61], 24.197072451914316);
  // FX-P02's first sample: KRAS 38/195, SMARCA4 215/313, PIK3CA 267/792
  close(vafBandwidth([38 / 195, 215 / 313, 267 / 792]), 0.17591645900865704);
  close(vafDensity([38 / 195, 215 / 313, 267 / 792])[44], 1.4018806076861716);
});

const T1 = { id: "P-T1", label: "1", color: "black", values: [38 / 195, 215 / 313, 267 / 792] };
const T2 = { id: "P-T2", label: "2", color: "orange", values: [190 / 280] };
const vafPlotSvg = (samples: Parameters<typeof vafSeries>[0], o: Parameters<typeof draw>[1], S?: Parameters<typeof draw>[2]) => draw(vafSeries(samples), o, S);
const attrs = (svg: string, el: string, attr: string) => [...svg.matchAll(new RegExp("<" + el + " [^>]*" + attr + "=\"([^\"]*)\"", "g"))].map((m) => m[1]);

test("Y, O: bars on the count axis, faint with several samples, darker with one, the picked sample's alone", () => {
  const both = vafPlotSvg([T1, T2], { histogram: true, curve: true }).svg;
  assert.equal(attrs(both, "rect", "data-sample").length, 4, "one bar per non-empty bin: T1's three, T2's one");
  assert.deepEqual([...new Set(attrs(both, "rect", "opacity"))], ["0.1"]);
  assert.equal(attrs(both, "path", "data-sample").length, 2);
  const heights = attrs(both, "rect", "height").map(Number);
  assert.ok(heights.every((h) => h === STYLE.vafPlot.height), "each bin holds 1, the fullest bin: full height");
  assert.match(both, />mutation count</); assert.match(both, />variant allele frequency</);
  const one = vafPlotSvg([T2], { histogram: true, curve: true }).svg;
  assert.deepEqual([...new Set(attrs(one, "rect", "opacity"))], ["0.3"]);
  const oneWithReads = vafPlotSvg([{ ...T1, values: [] }, T2], { histogram: true, curve: true }).svg;
  assert.deepEqual([...new Set(attrs(oneWithReads, "rect", "opacity"))], ["0.1"], "two samples in view, one without reads: still the several-sample opacity");
  const picked = vafPlotSvg([T1, T2], { histogram: true, curve: true, only: "P-T2" }).svg;
  assert.deepEqual(attrs(picked, "rect", "data-sample"), ["P-T2"]); assert.deepEqual(attrs(picked, "path", "data-sample"), ["P-T2"]);
  assert.deepEqual(attrs(picked, "rect", "opacity"), ["0.5"]);
  const twoInBin = vafPlotSvg([{ ...T1, values: [0.31, 0.32, 0.7] }], { histogram: true, curve: false }).svg;
  assert.deepEqual(attrs(twoInBin, "rect", "height").map(Number).sort(), [100, 200], "a bin of 1 is half the height of the fullest, 2");
});

test("the histogram and the curve each drawn only when ticked", () => {
  const noHist = vafPlotSvg([T1, T2], { histogram: false, curve: true }).svg;
  assert.equal(attrs(noHist, "rect", "data-sample").length, 0); assert.equal(attrs(noHist, "path", "data-sample").length, 2);
  const noCurve = vafPlotSvg([T1, T2], { histogram: true, curve: false }).svg;
  assert.equal(attrs(noCurve, "path", "data-sample").length, 0);
});

test("E: a sample without allele frequencies draws nothing; none at all, no plot", () => {
  const svg = vafPlotSvg([T1, { ...T2, values: [] }], { histogram: true, curve: true }).svg;
  assert.ok(!attrs(svg, "rect", "data-sample").includes("P-T2"));
  assert.ok(!attrs(svg, "path", "data-sample").includes("P-T2"));
  assert.equal(hasVafs([{ ...T1, values: [] }, T2]), true, "the first sample empty, the second not: there is a plot");
  assert.equal(hasVafs([{ ...T1, values: [] }]), false);
});

test("sizes and opacities come from the style (invariant 8)", () => {
  const S = { ...STYLE, vafPlot: { ...STYLE.vafPlot, height: 100, barOpacityMany: 0.2 } };
  const svg = vafPlotSvg([T1, T2], { histogram: true, curve: false }, S).svg;
  assert.deepEqual([...new Set(attrs(svg, "rect", "height").map(Number))], [100]);
  assert.deepEqual([...new Set(attrs(svg, "rect", "opacity"))], ["0.2"]);
});

test("the axes follow the page's theme (the default palette's CSS colours), light when asked", () => {
  const page = vafPlotSvg([T1], { histogram: true, curve: true }).svg;
  assert.match(page, /fill="var\(--/); assert.doesNotMatch(page, /fill="#/, "no literal colour on the axes");
  assert.match(vafPlotSvg([T1], { histogram: true, curve: true, theme: "light" }).svg, /#5b6b76/);
});
