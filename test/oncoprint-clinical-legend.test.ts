// The clinical tracks' legend (ONC-ST-4), against the case table cited to legacy cbioportal-frontend
// cd8c6df, packages/oncoprintjs/src/js/: LR = oncoprintlegendrenderer.ts, RS = oncoprintruleset.ts.
// The portal sorts a categorical track's legend rules by legend_order, then legend_label with
// localeCompare (LR 103-157); the NA rule "No data" has legend_order +Infinity, so it is last
// (RS 700-709), and only rules active for the drawn data appear. A bar track's legend is its value
// range rounded to 2 decimals and a bar filled green, red, or red | green split at 0 (LR 257-320,
// RS 865-876, 1067-1121). The colours of the values (trackCategoryColor) do not change with the order.
import test from "node:test";
import assert from "node:assert/strict";
import * as style from "../lib/oncoprint-style.ts";
import { STYLE, trackCategoryColor, encodeNumeric } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { assembleContract } from "../lib/oncoprint-assemble.ts";
import type { Contract } from "../lib/types.ts";

type CatTrack = { label: string; kind: "clinical"; categories: string[]; cells: number[] };
type NumTrack = { label: string; kind: "clinical"; numeric: true; bar: true; min: number; max: number; cells: number[]; values: number[] };
type Legend =
  | { kind: "categories"; entries: { label: string; color: string }[]; more: number }
  | { kind: "number"; min: string; max: string; fill: "positive" | "negative" | "split" };

function clinicalLegend(track: CatTrack | NumTrack, S = STYLE, colors?: Record<string, Record<string, string>>, shown?: number[]): Legend {
  const fn = (style as Record<string, unknown>).clinicalLegend;
  assert.equal(typeof fn, "function", "lib/oncoprint-style.ts exports clinicalLegend(track, S?, colors?, shown?)");
  return (fn as (...a: unknown[]) => Legend)(track, S, colors, shown);
}
function categories(l: Legend) {
  assert.equal(l.kind, "categories", "a categorical track has a categories legend");
  return l as Extract<Legend, { kind: "categories" }>;
}
function number(l: Legend) {
  assert.equal(l.kind, "number", "a bar track has a number legend");
  return l as Extract<Legend, { kind: "number" }>;
}
const labels = (l: Legend) => categories(l).entries.map((e) => e.label);

/** a categorical track: categories in the order given (the engine's, by frequency), one cell per value, undefined = no value */
function cat(values: (string | undefined)[], order?: string[], label = "X"): CatTrack {
  const cats = order ?? [...new Set(values.filter((v): v is string => v !== undefined))];
  return { label, kind: "clinical", categories: cats, cells: values.map((v) => (v === undefined ? -1 : cats.indexOf(v))) };
}
function bar(values: number[], label = "N"): NumTrack {
  const min = Math.min(...values), max = Math.max(...values);
  return { label, kind: "clinical", numeric: true, bar: true, min, max, values, cells: values.map((v) => encodeNumeric(v, min, max)) };
}
function contractOf(track: CatTrack | NumTrack, display: Record<string, unknown> = {}): Contract {
  const n = track.cells.length;
  return { study: "s", studies: ["s"], groups: [{ name: "all", start: 0, count: n }], columns: Array.from({ length: n }, (_, i) => "P" + i),
    unit: "patient", conventions: { sort: [] }, stats: { nColumns: n }, display, tracks: [track] } as unknown as Contract;
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** the server SVG's legend for track `label`: its swatch + label pairs in drawing order, and the segment's raw text */
function svgLegend(svg: string, label: string): { entries: { label: string; color: string }[]; text: string } {
  const re = new RegExp('<text x="([\\d.]+)"[^>]*>' + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "</text>", "g");
  const heads = [...svg.matchAll(re)];
  assert.ok(heads.length > 0, "the SVG has a legend row for " + label);
  const head = heads[heads.length - 1];
  const start = head.index! + head[0].length;
  const next = svg.indexOf('<text x="' + head[1] + '"', start);
  const seg = svg.slice(start, next < 0 ? svg.length : next);
  const entries = [...seg.matchAll(/((?:<rect[^>]*\/>)+)<text[^>]*>([^<]*)<\/text>/g)].map((m) => ({
    label: unescape(m[2]), color: (/fill="([^"]+)"/.exec(m[1])?.[1] ?? "").toLowerCase() }));
  return { entries, text: seg };
}
/** each entry's swatch (all but "No data") is the value's own colour, the one its cells are drawn in */
function assertValueColours(track: CatTrack, entries: { label: string; color: string }[], colors?: Record<string, Record<string, string>>) {
  for (const e of entries) {
    if (e.label === "No data") continue;
    const k = track.categories.indexOf(e.label);
    assert.ok(k >= 0, "legend entry " + e.label + " is one of the track's values");
    assert.equal(e.color.toLowerCase(), trackCategoryColor(track, k, STYLE, colors).toLowerCase(), "swatch of " + e.label);
  }
}

test("L1: categories by frequency Zeta x3, Beta x2, Alpha x1 list as Alpha, Beta, Zeta (LR 103-157)", () => {
  const t = cat(["Zeta", "Zeta", "Zeta", "Beta", "Beta", "Alpha"]);
  const l = categories(clinicalLegend(t));
  assert.deepEqual(labels(l), ["Alpha", "Beta", "Zeta"]);
  assert.equal(l.more, 0);
  assert.deepEqual(svgLegend(contractToSvg(contractOf(t), 800), "X").entries.map((e) => e.label), ["Alpha", "Beta", "Zeta"], "server SVG order");
});

test("L2: numbers stored as text \"1\", \"10\", \"2\" sort by localeCompare, not numerically: 1, 10, 2 (LR 107)", () => {
  const t = cat(["2", "2", "2", "10", "10", "1"]);
  assert.deepEqual(labels(clinicalLegend(t)), ["1", "10", "2"]);
  assert.deepEqual(svgLegend(contractToSvg(contractOf(t), 800), "X").entries.map((e) => e.label), ["1", "10", "2"], "server SVG order");
});

test("L3: case \"b\", \"B\", \"a\" sorts by localeCompare: a, b, B (LR 107)", () => {
  const t = cat(["B", "B", "B", "b", "b", "a"]);
  assert.deepEqual(labels(clinicalLegend(t)), ["a", "b", "B"]);
  assert.deepEqual(svgLegend(contractToSvg(contractOf(t), 800), "X").entries.map((e) => e.label), ["a", "b", "B"], "server SVG order");
});

test("L4: some columns have no value, so \"No data\" comes last (RS 700-709, LR 141-155)", () => {
  const t = cat(["Zeta", undefined, "Alpha", undefined, "Zeta", "Beta"]);
  assert.deepEqual(labels(clinicalLegend(t)), ["Alpha", "Beta", "Zeta", "No data"]);
  assert.deepEqual(svgLegend(contractToSvg(contractOf(t), 800), "X").entries.map((e) => e.label), ["Alpha", "Beta", "Zeta", "No data"], "server SVG order");
});

test("L5: every column has a value, so there is no \"No data\" entry (RS active rules 365-510)", () => {
  const t = cat(["Zeta", "Alpha", "Beta"]);
  assert.ok(!labels(clinicalLegend(t)).includes("No data"));
  assert.ok(!svgLegend(contractToSvg(contractOf(t), 800), "X").entries.some((e) => e.label === "No data"), "server SVG");
});

test("L6: a value (or no value) that no drawn column has is not in the legend (RS active rules 365-510)", () => {
  // columns 3 and 4 are not drawn: "Hidden" and the missing value live only there
  const t = cat(["Alpha", "Beta", "Alpha", "Hidden", undefined]);
  assert.deepEqual(labels(clinicalLegend(t, STYLE, undefined, [0, 1, 2])), ["Alpha", "Beta"]);
  assert.deepEqual(labels(clinicalLegend(t)), ["Alpha", "Beta", "Hidden", "No data"], "all columns drawn by default");
  // the server SVG draws every column (Show unaltered applies in the browser), so its legend lists
  // every value: P2, unaltered, is drawn there with "Hidden"
  const pids = ["P0", "P1", "P2"];
  const c = assembleContract({ genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"],
    events: [{ pid: "P0", gene: "G", vt: "mutation", mt: "missense", driver: false }, { pid: "P1", gene: "G", vt: "mutation", mt: "missense", driver: false }],
    coverage: pids.map((pid) => ({ pid, genes: ["G"] })), isDriver: () => false, annotationSource: "t",
    clinical: [{ attr: "X", values: new Map([["P0", "Alpha"], ["P1", "Beta"], ["P2", "Hidden"]]) }], heatmap: [], derived: [], sort: [], lineGap: 0,
    display: { showUnaltered: false, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true, hideVUS: false, annotate: "oncokb", whiteBackground: false } } as never);
  const svg = contractToSvg(c, 800);
  assert.deepEqual(svgLegend(svg, "X").entries.map((e) => e.label), ["Alpha", "Beta", "Hidden"], "the server SVG draws P2");
});

test("L7: each entry's swatch is the value's own colour, the same as its cells, unchanged by the reorder (RS)", () => {
  const t = cat(["Zeta", "Zeta", "Zeta", "Beta", "Beta", "Alpha", undefined]);
  assertValueColours(t, categories(clinicalLegend(t)).entries);
  const colors = { X: { Beta: "#123456" } };
  const over = categories(clinicalLegend(t, STYLE, colors));
  assert.equal(over.entries.find((e) => e.label === "Beta")?.color.toLowerCase(), "#123456", "a per-track override colours its entry");
  assertValueColours(t, over.entries, colors);
  const svg = svgLegend(contractToSvg(contractOf(t), 800), "X");
  assert.deepEqual(svg.entries.map((e) => e.label), ["Alpha", "Beta", "Zeta", "No data"]);
  assertValueColours(t, svg.entries);
  const svgOver = svgLegend(contractToSvg(contractOf(t, { colors }), 800), "X");
  assertValueColours(t, svgOver.entries, colors);
});

test("L8: reserved values (\"Yes\", \"No\") sort alphabetically with the rest: No, Other, Yes (LR 103-157)", () => {
  const t = cat(["Yes", "Yes", "Yes", "Other", "Other", "No"]);
  const l = categories(clinicalLegend(t));
  assert.deepEqual(labels(l), ["No", "Other", "Yes"]);
  assertValueColours(t, l.entries);
  const svg = svgLegend(contractToSvg(contractOf(t), 800), "X");
  assert.deepEqual(svg.entries.map((e) => e.label), ["No", "Other", "Yes"], "server SVG order");
  assertValueColours(t, svg.entries);
});

test("L9: more than 8 values shows the first 8 in the portal's order, then \"+N more\" (ours; the portal lists all)", () => {
  // ten values, the commonest last alphabetically
  const names = ["Kappa", "Juliet", "India", "Hotel", "Golf", "Foxtrot", "Echo", "Delta", "Charlie", "Bravo"];
  const values = names.flatMap((v, i) => Array(names.length - i).fill(v) as string[]);
  const t = cat(values);
  const l = categories(clinicalLegend(t));
  assert.deepEqual(labels(l), ["Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"]);
  assert.equal(l.more, 2);
  const svg = svgLegend(contractToSvg(contractOf(t), 1200), "X");
  assert.deepEqual(svg.entries.map((e) => e.label), ["Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"], "server SVG order");
  assertValueColours(t, svg.entries);
  assert.match(svg.text, /\+2 more/, "server SVG says how many it left out");
});

test("L10: a numeric (bar) track with values 0..8 has legend \"0\" and \"8\", green (LR 257-300, RS 870-876)", () => {
  assert.deepEqual(clinicalLegend(bar([0, 1, 2, 3, 4, 5, 6, 7, 8])), { kind: "number", min: "0", max: "8", fill: "positive" });
});

test("L11: a numeric track with values -3..8 has \"-3\" and \"8\", red below 0 and green above (LR 290-305)", () => {
  assert.deepEqual(clinicalLegend(bar([-3, -1, 0, 4, 8])), { kind: "number", min: "-3", max: "8", fill: "split" });
});

test("L12: a numeric track with values -5..-1 is red (LR 290, RS 870-871)", () => {
  assert.deepEqual(clinicalLegend(bar([-5, -3, -1])), { kind: "number", min: "-5", max: "-1", fill: "negative" });
});

test("L13: range labels are rounded to 2 decimals: 2.345 -> 2.35, 8 -> 8 (LR 258-263)", () => {
  const l = number(clinicalLegend(bar([0.5, 1, 2.345])));
  assert.equal(l.min, "0.5");
  assert.equal(l.max, "2.35");
  assert.equal(number(clinicalLegend(bar([1.123456, 8]))).max, "8");
  assert.equal(number(clinicalLegend(bar([1.123456, 8]))).min, "1.12");
});

test("L14: the server SVG draws the same entries in the same order as the shared rule (ours)", () => {
  const t = cat(["b", "B", "B", undefined, "Yes", "10", "2", "2", "No", "a"]);
  const rule = categories(clinicalLegend(t));
  const svg = svgLegend(contractToSvg(contractOf(t), 1200), "X");
  assert.deepEqual(svg.entries.map((e) => e.label), rule.entries.map((e) => e.label));
  assert.deepEqual(svg.entries.filter((e) => e.label !== "No data").map((e) => e.color),
    rule.entries.filter((e) => e.label !== "No data").map((e) => e.color.toLowerCase()));
});
