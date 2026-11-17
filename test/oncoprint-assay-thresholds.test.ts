// Generic-assay threshold values (">8", "< 0.0015") on the OncoPrint, from the case table written
// from the legacy source (cbioportal-frontend cd8c6df). Case ids are the table's (A1…):
//   GC = src/shared/cache/GenericAssayMolecularDataCache.ts 64-95 handleValueThreshold: a value
//        matching /^([><]? *)(-?\d+(\.\d+)?)$/ is its number, a leading ">" or "<" its threshold
//   DU = src/shared/components/oncoprint/DataUtils.ts 407-424: category = sign + number.toFixed(2)
//   OU = src/shared/components/oncoprint/OncoprintUtils.ts 346-498: the range is over the numbers,
//        threshold ones included; each distinct category, in data order, takes the next of
//        #f0e442 #009e73 #cc79a7 #000000 (cycling) and is drawn in it, not the gradient
//   SU = SortUtils heatmapTrackSortComparator: by profile_data, a threshold value as its number
//   TD = tabularDownload.ts 222: profile_data, the number
// Ours: a threshold cell is coded −3 − k (k its category's index in the track's `thresholds`) and
// its `values` entry keeps the number. A8, A9 and A13 run against a database and are not here;
// A11 (the tooltip) lives inside OncoprintFigure's useMemo and has no pure function to test.
//
// The new exports are read through the module namespace so a missing one fails its own tests
// rather than the whole file.
import test from "node:test";
import assert from "node:assert/strict";
import * as onc from "../lib/oncoprint.ts";
import * as style from "../lib/oncoprint-style.ts";
import { assembleContract, normalizeDisplay, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { contractToTsv } from "../lib/oncoprint-tabular.ts";
import { aggregate, type TrackShape } from "../lib/oncoprint-lod.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { draw, sortColumns, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import type { Contract, Track } from "../lib/types.ts";

type Sign = ">" | "<";
type Parsed = { value: number; threshold: Sign | "" } | null;
const parseThresholdValue = (text: string): Parsed => {
  const f = (onc as Record<string, unknown>).parseThresholdValue;
  assert.equal(typeof f, "function", "lib/oncoprint.ts exports parseThresholdValue");
  return (f as (s: string) => Parsed)(text);
};
const thresholdColor = (k: number, S?: unknown): string => {
  const f = (style as Record<string, unknown>).thresholdColor;
  assert.equal(typeof f, "function", "lib/oncoprint-style.ts exports thresholdColor");
  return String((f as (k: number, S?: unknown) => string)(k, S)).toLowerCase();
};
const PALETTE = ["#f0e442", "#009e73", "#cc79a7", "#000000"];

type ThresholdTrack = Track & { thresholds?: string[] };
const SIG = "mutational_signatures_contribution_SBS";
const ENTITY = "SBS1";

/**
 * One generic-assay profile, one entity: a value per column C00.. (null = none), a column's value
 * given as text is parsed by the table's grammar (">90" → 90 with ">"). `insertReversed` puts the
 * entries into the maps last column first, so an order taken from the maps rather than the
 * columns shows.
 */
function thresholdContract(cells: (number | string | null)[], insertReversed = false): Contract {
  const pids = cells.map((_, i) => "C" + String(i).padStart(2, "0"));
  const values = new Map<string, number>(), thresholds = new Map<string, Sign>();
  const idx = cells.map((_, i) => i);
  for (const i of insertReversed ? idx.reverse() : idx) {
    const v = cells[i];
    if (v === null) continue;
    const key = pids[i] + "|" + ENTITY;
    if (typeof v === "number") { values.set(key, v); continue; }
    const m = /^([><]) *(-?\d+(\.\d+)?)$/.exec(v);
    assert.ok(m, "test input " + v);
    values.set(key, Number(m![2]));
    thresholds.set(key, m![1] as Sign);
  }
  const input: AssembleInput = {
    genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["G"] })),
    isDriver: () => false, annotationSource: "t", clinical: [], derived: [], sort: [], lineGap: 0, display: normalizeDisplay({}),
    heatmap: [{ profileType: SIG, genes: [ENTITY], isVaf: false, assay: true, values, thresholds } as AssembleInput["heatmap"][number]]
  };
  return assembleContract(input);
}
const assayTrack = (c: Contract): ThresholdTrack => {
  const t = c.tracks.find((x) => x.kind === "heatmap");
  assert.ok(t, "an assay heatmap row: " + c.tracks.map((x) => x.kind + " " + x.label).join(", "));
  return t as ThresholdTrack;
};
const col = (c: Contract, i: number) => c.columns.indexOf("C" + String(i).padStart(2, "0"));
const unpack = (c: Contract) => { const buf = packContract(c); return unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer); };

/** any CSS colour this code writes, as lower-case #rrggbb */
function hex(c: unknown): string {
  const s = String(c).trim().toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((x) => x + x).join("");
  return s;
}

// ---- A1, A2: the grammar (GC 64-95) -----------------------------------------------------------

test("A1: a threshold value is its number and its sign; spaces may follow the sign (GC regex ^([><]? *)(-?\\d+(\\.\\d+)?)$)", () => {
  const cases: [string, Parsed][] = [
    [">90", { value: 90, threshold: ">" }],
    ["<1", { value: 1, threshold: "<" }],
    ["> 8", { value: 8, threshold: ">" }],
    [">   8", { value: 8, threshold: ">" }],
    ["< 0.0015", { value: 0.0015, threshold: "<" }],
    ["> -2.5", { value: -2.5, threshold: ">" }],
    ["<-3", { value: -3, threshold: "<" }],
    [">10.0015", { value: 10.0015, threshold: ">" }]
  ];
  for (const [text, want] of cases) assert.deepEqual(parseThresholdValue(text), want, JSON.stringify(text));
});

test("A1: a plain number is its number with no threshold", () => {
  for (const [text, value] of [["-3", -3], ["10", 10], ["10.0015", 10.0015], ["0", 0]] as const)
    assert.deepEqual(parseThresholdValue(text), { value, threshold: "" }, JSON.stringify(text));
});

test("A2: plain-number text the regex rejects but finiteSql reads (\"1e3\", \".5\", \"+3\", \"1.\") is a number, not a threshold", () => {
  for (const [text, value] of [["1e3", 1000], [".5", 0.5], ["+3", 3], ["1.", 1]] as const)
    assert.deepEqual(parseThresholdValue(text), { value, threshold: "" }, JSON.stringify(text));
});

test("A2: outside the grammar is neither (\">=5\", \"8>\", a sign before an exponent, a leading dot, a plus, a space before the sign or after the number)", () => {
  for (const text of [">=5", "<=5", "8>", ">1e3", ">.5", "> +3", ">>5", "><5", " >5", ">5 ", ">1.", ">", "<", "", "abc", "NaN", "inf", ">NaN"])
    assert.equal(parseThresholdValue(text), null, JSON.stringify(text));
});

// ---- A3, A4: assembly (DU 407-424, OU 471-486) --------------------------------------------------

test("A3: a value 90 with threshold \">\" among plain 10, 50 is cell −3, value 90, category \">90.00\"; the range includes 90", () => {
  const c = thresholdContract([10, 50, ">90"]);
  const t = assayTrack(c);
  assert.deepEqual(t.thresholds, [">90.00"]);
  assert.equal(t.cells[col(c, 2)], -3);
  assert.equal(t.values![col(c, 2)], 90);
  assert.ok(t.max! >= 90, "range max " + t.max + " includes 90 (OU 382-392)");
  // the plain values are gradient codes on that range: 50 is below its top
  for (const i of [0, 1]) assert.ok(t.cells[col(c, i)] >= 0 && t.cells[col(c, i)] < 255, "C0" + i + " code " + t.cells[col(c, i)]);
  assert.equal(t.values![col(c, 0)], 10);
  assert.equal(t.values![col(c, 1)], 50);
});

test("A3: a track with no threshold value carries no `thresholds`", () => {
  const t = assayTrack(thresholdContract([10, 50, 90]));
  assert.ok(t.thresholds === undefined || t.thresholds.length === 0, JSON.stringify(t.thresholds));
  assert.ok(Array.from(t.cells).every((x) => x >= -2), Array.from(t.cells).join(","));
});

test("A3: the category is sign + toFixed(2) (\"< 0.0015\" → \"<0.00\", \"> -2.5\" → \">-2.50\")", () => {
  const c = thresholdContract(["< 0.0015", "> -2.5", 1]);
  const t = assayTrack(c);
  assert.deepEqual(t.thresholds, ["<0.00", ">-2.50"]);
  assert.equal(t.cells[col(c, 0)], -3); assert.equal(t.cells[col(c, 1)], -4);
  assert.ok(Math.abs(t.values![col(c, 0)] - 0.0015) < 1e-6, String(t.values![col(c, 0)]));
  assert.equal(t.values![col(c, 1)], -2.5);
});

test("A4: two categories \">90.00\", \"<1.00\" in that column order: thresholds [\">90.00\", \"<1.00\"], cells −3 and −4; a repeat reuses its code", () => {
  const c = thresholdContract([">90", 5, "<1", ">90", "<1", null]);
  const t = assayTrack(c);
  // first appearance over the contract's columns, as drawn
  const cats = [">90.00", 5, "<1.00", ">90.00", "<1.00", null];
  const order: string[] = [];
  for (const id of c.columns) { const x = cats[+id.slice(1)]; if (typeof x === "string" && !order.includes(x)) order.push(x); }
  assert.deepEqual(order, [">90.00", "<1.00"], "precondition: the contract keeps the columns' order");
  assert.deepEqual(t.thresholds, [">90.00", "<1.00"]);
  assert.deepEqual([0, 2, 3, 4].map((i) => t.cells[col(c, i)]), [-3, -4, -3, -4]);
  assert.deepEqual([0, 2, 3, 4].map((i) => t.values![col(c, i)]), [90, 1, 90, 1]);
  assert.ok(t.cells[col(c, 1)] >= 0, "the plain 5 is a gradient code");
  assert.equal(t.cells[col(c, 5)], -1, "no value: not profiled");
});

test("A4: the categories' order is the columns', not the order the values arrived in", () => {
  const c = thresholdContract([">90", 5, "<1"], true);
  assert.deepEqual(assayTrack(c).thresholds, [">90.00", "<1.00"]);
});

test("A4: the same number with different signs is two categories (\">5.00\", \"<5.00\")", () => {
  const c = thresholdContract([">5", "<5", 5]);
  const t = assayTrack(c);
  assert.deepEqual(t.thresholds, [">5.00", "<5.00"]);
  assert.deepEqual([0, 1].map((i) => t.cells[col(c, i)]), [-3, -4]);
  assert.ok(t.cells[col(c, 2)] >= 0);
});

// ---- A5: colours (OU 369-374, 471-486) ----------------------------------------------------------

test("A5: STYLE.glyph.assayThreshold.colors is the portal's four category colours", () => {
  const g = (style.STYLE.glyph as Record<string, unknown>).assayThreshold as { colors?: string[] } | undefined;
  assert.ok(g, "STYLE.glyph.assayThreshold");
  assert.deepEqual(g!.colors!.map((x) => x.toLowerCase()), PALETTE);
});

test("A5: category k is #f0e442, #009e73, #cc79a7, #000000, then #f0e442 again", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 8].map((k) => thresholdColor(k)), [...PALETTE, PALETTE[0], PALETTE[1], PALETTE[3], PALETTE[0]]);
});

test("A5: thresholdColor reads the style it is given", () => {
  const S = { ...style.STYLE, glyph: { ...style.STYLE.glyph, assayThreshold: { colors: ["#111111", "#222222"] } } };
  assert.deepEqual([0, 1, 2, 3].map((k) => thresholdColor(k, S)), ["#111111", "#222222", "#111111", "#222222"]);
});

// ---- A6: drawn (OU) -----------------------------------------------------------------------------

/** the fills of the track's row in the server SVG, inside the plot, left to right */
function svgRow(svg: string, ti: number): string[] {
  const G = style.STYLE.geometry, y0 = G.header + ti * (G.rowH + G.rowGap);
  const out: { x: number; fill: string }[] = [];
  for (const m of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"\/>/g)) {
    const x = +m[1], y = +m[2], h = +m[4];
    if (x >= G.gutter && h === G.rowH && Math.abs(y - y0) < 1e-6) out.push({ x, fill: hex(m[5]) });
  }
  return out.sort((a, b) => a.x - b.x).map((r) => r.fill);
}

test("A6 (SVG): a −3−k cell is filled in category k's colour, a plain cell in the gradient", () => {
  const c = thresholdContract([">90", 5, "<1", ">90", 50]);
  const t = assayTrack(c);
  const row = svgRow(contractToSvg(c, 1200), c.tracks.indexOf(t));
  assert.equal(row.length, c.columns.length, "one rect per column");
  const want = (i: number) => {
    const code = t.cells[col(c, i)];
    return code <= -3 ? thresholdColor(-3 - code) : null;
  };
  assert.equal(want(0), PALETTE[0]); assert.equal(want(2), PALETTE[1]);
  for (const i of [0, 2, 3]) assert.equal(row[col(c, i)], want(i), "C0" + i);
  for (const i of [1, 4]) assert.equal(row[col(c, i)], hex(style.heatColor(t as never, t.cells[col(c, i)])), "C0" + i + " gradient");
});

test("A6 (SVG): the legend names each category beside a swatch of its colour", () => {
  const c = thresholdContract([">90", 5, "<1"]);
  const svg = contractToSvg(c, 1200);
  const swatches = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="10" height="10" fill="([^"]+)"\/>\s*<text x="([\d.]+)"[^>]*>([^<]*)</g)]
    .map((m) => ({ fill: hex(m[3]), text: m[5] }));
  for (const [k, cat] of [[0, ">90.00"], [1, "&lt;1.00"]] as const) {
    assert.ok(svg.includes(cat), "legend text " + cat);
    assert.ok(swatches.some((s) => s.text === cat && s.fill === PALETTE[k]), cat + " with a " + PALETTE[k] + " swatch: " + JSON.stringify(swatches.filter((s) => /\d\.\d\d$/.test(s.text))));
  }
});

test("A6 (canvas): `thresholds` survives packing, and a −3−k cell is filled in category k's colour", () => {
  const c = thresholdContract([">90", 5, "<1", ">90", 50]);
  const t = assayTrack(c);
  const data = unpack(c);
  const ti = c.tracks.indexOf(t);
  assert.deepEqual((data.tracks[ti] as { thresholds?: string[] }).thresholds, [">90.00", "<1.00"]);
  const fills: { x: number; y: number; h: number; style: string }[] = [];
  let fillStyle = "";
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillRect") return (x: number, y: number, _w: number, h: number) => fills.push({ x, y, h, style: fillStyle });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "fillStyle") return fillStyle;
      return () => {};
    },
    set(_t, k, val) { if (k === "fillStyle") fillStyle = String(val); return true; }
  }) as unknown as CanvasRenderingContext2D;
  const n = c.columns.length;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
  draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), groups, { zoom: 10, scrollX: 0, whitespace: true }, 1200, undefined, { gap: 0 });
  const rowY = GEOM.header + ti * (GEOM.rowH + GEOM.rowGap);
  const byX = new Map<number, string>();
  for (const f of fills) if (f.h === GEOM.rowH && Math.abs(f.y - rowY) < 1e-9 && f.x >= GEOM.gutter) byX.set(f.x, f.style);
  const xs = [...byX.keys()].sort((a, b) => a - b);
  assert.equal(xs.length, n, "one cell per column");
  const at = (i: number) => hex(byX.get(xs[col(c, i)]));
  assert.equal(at(0), PALETTE[0]); assert.equal(at(3), PALETTE[0]); assert.equal(at(2), PALETTE[1]);
  for (const i of [1, 4]) assert.equal(at(i), hex(style.heatColor(t as never, t.cells[col(c, i)])), "C0" + i + " gradient");
});

// ---- A7: sort by the row (SU) -------------------------------------------------------------------

test("A7: sorting by the row places threshold columns by their numbers among the plain values", () => {
  const c = thresholdContract([50, ">90", 10, "<1", 95]);
  const t = assayTrack(c);
  assert.deepEqual([1, 3].map((i) => t.cells[col(c, i)]), [-3, -4], "precondition: C01 and C03 are threshold cells");
  const data = unpack(c), n = c.columns.length;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
  const ids = (o: Uint32Array) => Array.from(o, (i) => c.columns[i]);
  const order = Uint32Array.from({ length: n }, (_, i) => i);
  assert.deepEqual(ids(sortColumns(data, order, groups, [{ track: t.label, dir: "asc" }])), ["C03", "C02", "C00", "C01", "C04"]);
  assert.deepEqual(ids(sortColumns(data, order, groups, [{ track: t.label, dir: "desc" }])), ["C04", "C01", "C00", "C02", "C03"]);
});

// ---- A10: zoomed out (lib/oncoprint-lod.ts aggregate) --------------------------------------------

test("A10: a pixel's code is the mean of its plain values' codes; threshold cells do not enter it", () => {
  const T: TrackShape = { kind: "heatmap", numeric: true };
  const s = new Int32Array(64);
  assert.equal(aggregate(T, [100, -3, 200], null, 0, 3, s), 150);
  assert.equal(aggregate(T, [-4, 10, -3, -1, -2], null, 0, 5, s), 10);
});

test("A10: with no plain value, the pixel is the first threshold category in it", () => {
  const T: TrackShape = { kind: "heatmap", numeric: true };
  const s = new Int32Array(64);
  assert.equal(aggregate(T, [-1, -4, -3], null, 0, 3, s), -4);
  assert.equal(aggregate(T, [-3, -4], null, 0, 2, s), -3);
  assert.equal(aggregate(T, [-2, -5, -1], null, 0, 3, s), -5, "a threshold beats profiled-without-value");
  // with an order, "first" is the first position
  assert.equal(aggregate(T, [-3, -4, -1], [2, 1, 0], 0, 3, s), -4);
  // the existing codes are unchanged
  assert.equal(aggregate(T, [-1, -2], null, 0, 2, s), -2);
  assert.equal(aggregate(T, [-1, -1], null, 0, 2, s), -1);
});

// ---- A12: Tabular download (TD 222) -------------------------------------------------------------

test("A12: the Tabular download writes a threshold cell's number (90), not its category", () => {
  const c = thresholdContract([10, ">90", "<1", null]);
  const t = assayTrack(c);
  assert.deepEqual([1, 2].map((i) => t.cells[col(c, i)]), [-3, -4], "precondition: threshold cells");
  const tsv = contractToTsv(c, Uint32Array.from({ length: c.columns.length }, (_, i) => i)).replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
  const header = tsv[0];
  const row = tsv.find((r) => r[1].startsWith("HEATMAP") && (r[0] === ENTITY || r[0] === t.label));
  assert.ok(row, "a heatmap row: " + tsv.map((r) => r.slice(0, 2).join(" ")).join("; "));
  const cell = (i: number) => row![header.indexOf("C0" + i)];
  assert.equal(cell(0), "10"); assert.equal(cell(1), "90"); assert.equal(cell(2), "1"); assert.equal(cell(3), "");
});

// ---- A8, A9, A13: the query (text only; the rows are checked against databases) ------------------

test("A8/A9: assayHeatmapSql selects the representing value's threshold sign as a column aliased t", () => {
  for (const unit of ["patient", "sample"] as const)
    for (const patientLevel of [false, true]) {
      const sql = onc.assayHeatmapSql(SIG, [ENTITY], "s", "db", unit, patientLevel);
      assert.match(sql, /\bAS t\b/, unit + (patientLevel ? " patient-level" : ""));
      assert.match(sql, /\bAS v\b/, unit + " still selects v");
    }
});
