// A generic-assay heatmap track's range and colours (ONC-TT-8), from the case table written from
// the legacy source (cbioportal-frontend cd8c6df). Row ids are the table's:
//   OU  = src/shared/components/oncoprint/OncoprintUtils.ts getGenericAssayTrackRuleSetParams (316-496)
//   DeU = src/shared/components/oncoprint/DeltaUtils.ts 720-749, 856-861 (the profile's min/max)
//   RS  = packages/oncoprintjs/src/js/oncoprintruleset.ts GradientRuleSet (925-1060), BS = binarysearch.ts
//
// Expected colours are the legacy's: RS makeColorFn maps the stops and the value to t over the
// range, finds the interval with binarysearch (closest lower if not found; an exact hit on a
// repeated stop [.., p, p, ..] lands on the middle index, i.e. the second p, BS:13-16) and
// interpolates with Math.round per channel. A value exactly at a pivot of the blue-to-red
// gradient is therefore light red (#ffe2cc).
//
// `stops`, `colors`, `min`, `max` are compared exactly. A drawn cell carries its value as one of
// 256 codes, so a drawn colour (engine heatColor of the cell code, server SVG, browser canvas) is
// compared within one unit per channel.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { STYLE, heatColor } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { draw, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { Contract, Track } from "../lib/types.ts";

type Rgb = [number, number, number];
const DB: Rgb = [0, 114, 178], LB: Rgb = [204, 236, 255], LR: Rgb = [255, 226, 204], DR: Rgb = [213, 94, 0], W: Rgb = [255, 255, 255];
type AssayTrack = Track & { stops?: number[]; colors?: number[][] };

const SIG = "mutational_signatures_contribution_SBS";
const EXPR = "rna_seq_v2_mrna_median_Zscores", METH = "methylation_hm450";

const base = (pids: string[]): AssembleInput => ({
  genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["G"] })),
  isDriver: () => false, annotationSource: "t", clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0
});

/** one generic-assay profile; entity -> its value per column (null = none); columns C00.. */
function assayContract(entities: Record<string, (number | null)[]>, opts: { pivot?: number; sortOrder?: "ASC" | "DESC"; profileType?: string; assay?: boolean } = {}): Contract {
  const n = Math.max(...Object.values(entities).map((v) => v.length));
  const pids = Array.from({ length: n }, (_, i) => "C" + String(i).padStart(2, "0"));
  const values = new Map<string, number>();
  for (const [e, vals] of Object.entries(entities)) vals.forEach((v, i) => { if (v !== null) values.set(pids[i] + "|" + e, v); });
  const entry: Record<string, unknown> = { profileType: opts.profileType ?? SIG, genes: Object.keys(entities), isVaf: false, assay: opts.assay ?? true, values };
  if (opts.pivot !== undefined) entry.pivot = opts.pivot;
  if (opts.sortOrder !== undefined) entry.sortOrder = opts.sortOrder;
  return assembleContract({ ...base(pids), heatmap: [entry] as AssembleInput["heatmap"] });
}
const heatTracks = (c: Contract) => c.tracks.filter((t) => t.kind === "heatmap") as AssayTrack[];
const heatTrack = (c: Contract) => heatTracks(c)[0];

function hex(color: string): string {
  const m = /^rgba?\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(color);
  if (!m) return color.toLowerCase();
  return "#" + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, "0")).join("");
}
const toHex = (c: Rgb) => "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
const ch = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
function near(got: string, want: string, where: string) {
  const [a, b] = [ch(got), ch(want)];
  assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= 1), `${where}: ${got} is not within one unit per channel of ${want}`);
}

function svgRows(svg: string) {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] }));
  return rects;
}

/** each column's drawn colour of track `t`, on every path: [value, engine, svg, canvas] */
function drawn(c: Contract, t: Track) {
  const n = c.columns.length;
  const vals = Array.from(t.values ?? [], (v) => (v == null ? NaN : Number(v)));
  assert.equal(vals.length, n, "the track carries one exact value per column");
  // engine
  const engine = Array.from(t.cells, (code) => (code < 0 ? null : hex(heatColor(t as never, code as number))));
  // server SVG: the cells are row-height rects, one row per track
  const cellRects = svgRows(contractToSvg(c)).filter((r) => r.h === STYLE.geometry.rowH);
  const ys = [...new Set(cellRects.map((r) => r.y))].sort((a, b) => a - b);
  const row = cellRects.filter((r) => r.y === ys[c.tracks.indexOf(t)]).sort((a, b) => a.x - b.x);
  assert.equal(row.length, n, "SVG draws one rect per column");
  const svg = row.map((r) => hex(r.fill));
  // browser canvas: record fillStyle at each fillRect
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const fills: { y: number; h: number; x: number; style: string }[] = [];
  let style = "";
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillRect") return (x: number, y: number, _w: number, h: number) => fills.push({ x, y, h, style });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "fillStyle") return style;
      return () => {};
    },
    set(_t, k, val) { if (k === "fillStyle") style = String(val); return true; }
  }) as unknown as CanvasRenderingContext2D;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
  draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), groups, { zoom: 10, scrollX: 0, whitespace: true }, 1200, undefined, { gap: 0 });
  const ti = c.tracks.indexOf(t);
  const rowY = GEOM.header + ti * (GEOM.rowH + GEOM.rowGap);
  const cells = fills.filter((f) => f.h === GEOM.rowH && Math.abs(f.y - rowY) < 1e-9 && f.x >= GEOM.gutter);
  const byX = new Map<number, string>();
  for (const f of cells) byX.set(f.x, f.style); // the last fill at an x is the one on top
  const xs = [...byX.keys()].sort((a, b) => a - b);
  const canvasAt = (i: number) => {
    const valued = vals.map((v, j) => (Number.isNaN(v) ? -1 : j)).filter((j) => j >= 0);
    if (xs.length === n) return hex(byX.get(xs[i])!);
    if (xs.length === valued.length) return hex(byX.get(xs[valued.indexOf(i)])!);
    assert.fail(`canvas drew ${xs.length} cells for ${n} columns`);
  };
  return vals.map((v, i) => ({ value: v, engine: engine[i], svg: svg[i], canvas: Number.isNaN(v) ? null : canvasAt(i) }));
}

/** every drawn cell whose exact value is a key of `want` is within one unit of that colour on every path */
function colourCells(c: Contract, t: Track, want: Record<string, string>) {
  const seen = new Set<string>();
  for (const d of drawn(c, t)) {
    // values travel as float32 (0.9 arrives as 0.89999998): match them at 6 decimals
    const key = String(Math.round(d.value * 1e6) / 1e6);
    const w = want[key];
    if (w === undefined) continue;
    seen.add(key);
    near(d.engine!, w, `value ${d.value}: engine cell code -> heatColor`);
    near(d.svg, w, `value ${d.value}: server SVG`);
    near(d.canvas!, w, `value ${d.value}: browser canvas`);
  }
  assert.deepEqual([...seen].sort(), Object.keys(want).sort(), "every expected value was drawn");
}

function shape(t: AssayTrack, min: number, max: number, stops: number[], colors: Rgb[]) {
  assert.deepEqual([t.min, t.max], [min, max], "range [min, max]");
  assert.deepEqual(t.stops && [...t.stops], stops, "stops");
  assert.deepEqual(t.colors && t.colors.map((x) => [...x].slice(0, 3)), colors, "colors");
}
/** code 0 is the range's min, 255 its max: the gradient's ends */
function ends(t: Track, lo: Rgb, hi: Rgb) {
  near(hex(heatColor(t as never, 0)), toHex(lo), "heatColor(code 0)");
  near(hex(heatColor(t as never, 255)), toHex(hi), "heatColor(code 255)");
}

// ---------------------------------------------------------------------------------------------

test("G1: one entity, values [1, 4], no pivot, no sort order -> [0, 4], white to dark red (OU 397-413)", () => {
  const c = assayContract({ e1: [1, 2, 4] });
  const t = heatTrack(c);
  shape(t, 0, 4, [0, 4], [W, DR]);
  ends(t, W, DR);
  near(hex(heatColor(t as never, 128)), "#eaaf80", "heatColor(code 128): halfway");
  colourCells(c, t, { 1: "#f5d7bf", 2: "#eaaf80", 4: "#d55e00" });
});

test("G2: values [-1, 4], no pivot -> [-1, 4], dark blue to light blue, no red (OU 427-429)", () => {
  const c = assayContract({ e1: [-1, 1.5, 4] });
  const t = heatTrack(c);
  shape(t, -1, 4, [-1, 4], [DB, LB]);
  ends(t, DB, LB);
  colourCells(c, t, { "-1": "#0072b2", 1.5: "#66afd9", 4: "#ccecff" });
});

test("G3: values [-4, -1], no pivot -> [-4, 0], dark blue to light blue (OU 397-401, 427)", () => {
  const c = assayContract({ e1: [-4, -2, -1] });
  const t = heatTrack(c);
  shape(t, -4, 0, [-4, 0], [DB, LB]);
  ends(t, DB, LB);
  colourCells(c, t, { "-4": "#0072b2", "-2": "#66afd9", "-1": "#99ceec" });
});

test("G4: values [1, 4], pivot 2 -> stops [0, 2, 4]: white, light red, dark red (OU 414-425)", () => {
  const c = assayContract({ e1: [1, 2, 3, 4] }, { pivot: 2 });
  const t = heatTrack(c);
  shape(t, 0, 4, [0, 2, 4], [W, LR, DR]);
  ends(t, W, DR);
  colourCells(c, t, { 1: "#fff1e6", 2: "#ffe2cc", 3: "#eaa066", 4: "#d55e00" });
});

test("G5: values [1, 4], pivot 0 (at the left end) -> white to dark red over [0, 4] (OU 409-413)", () => {
  const c = assayContract({ e1: [1, 4] }, { pivot: 0 });
  const t = heatTrack(c);
  shape(t, 0, 4, [0, 4], [W, DR]);
  ends(t, W, DR);
  colourCells(c, t, { 1: "#f5d7bf", 4: "#d55e00" });
});

test("G6: values [-4, -1], pivot -1 (= max) -> dark blue to light blue over [-4, 0] (OU 427-429)", () => {
  const c = assayContract({ e1: [-4, -1] }, { pivot: -1 });
  const t = heatTrack(c);
  shape(t, -4, 0, [-4, 0], [DB, LB]);
  ends(t, DB, LB);
  colourCells(c, t, { "-4": "#0072b2", "-1": "#99ceec" });
});

test("G7: values [-4, 3], pivot -4 (= min) -> light red to dark red over [-4, 3] (OU 430-432)", () => {
  const c = assayContract({ e1: [-4, -0.5, 3] }, { pivot: -4 });
  const t = heatTrack(c);
  shape(t, -4, 3, [-4, 3], [LR, DR]);
  ends(t, LR, DR);
  colourCells(c, t, { "-4": "#ffe2cc", "-0.5": "#eaa066", 3: "#d55e00" });
});

test("G8: values [-4, 3], pivot 1 -> dark blue, light blue, light red, dark red at [-4, 1, 1, 3] (OU 433-464)", () => {
  const c = assayContract({ e1: [-4, -1.5, 0.9, 2, 3] }, { pivot: 1 });
  const t = heatTrack(c);
  shape(t, -4, 3, [-4, 1, 1, 3], [DB, LB, LR, DR]);
  ends(t, DB, DR);
  colourCells(c, t, { "-4": "#0072b2", "-1.5": "#66afd9", 0.9: "#c8eafd", 2: "#eaa066", 3: "#d55e00" });
});

test("G8: a value exactly at the repeated stop (the pivot 1) is light red, the second stop's colour (RS 965-990, BS 13-16)", { todo: "a cell carries its value as one of 256 codes; the code nearest the pivot can fall on its other side (docs/PORTAL-PARITY.md)" }, () => {
  // binarysearch hits the middle index 2 of [-4, 1, 1, 3] first; spread to index 3 is non-zero, so
  // interval_t = 0 -> colors[2] = light red. The nearest code to 1 over [-4, 3] is 182 (0.996...),
  // which a code-only lookup would put on the blue side.
  const c = assayContract({ e1: [-4, 1, 3] }, { pivot: 1 });
  const t = heatTrack(c);
  colourCells(c, t, { 1: "#ffe2cc" });
});

test("G9: values [-4, -2], pivot 5 -> the pivot widens max to 5 = pivot: dark to light blue over [-4, 5] (OU 393-396, 427)", () => {
  const c = assayContract({ e1: [-4, -2] }, { pivot: 5 });
  const t = heatTrack(c);
  shape(t, -4, 5, [-4, 5], [DB, LB]);
  ends(t, DB, LB);
  colourCells(c, t, { "-4": "#0072b2", "-2": "#2d8dc3" });
});

test("G10: G2 with sort order DESC -> colours reversed: light blue to dark blue, stops unchanged (OU 467-470)", () => {
  const c = assayContract({ e1: [-1, 1.5, 4] }, { sortOrder: "DESC" });
  const t = heatTrack(c);
  shape(t, -1, 4, [-1, 4], [LB, DB]);
  ends(t, LB, DB);
  colourCells(c, t, { "-1": "#ccecff", 1.5: "#66afd9", 4: "#0072b2" });
});

test("G11: G1 with sort order DESC -> dark red to white (OU 467-470)", () => {
  const c = assayContract({ e1: [1, 2, 4] }, { sortOrder: "DESC" });
  const t = heatTrack(c);
  shape(t, 0, 4, [0, 4], [DR, W]);
  ends(t, DR, W);
  colourCells(c, t, { 1: "#e08640", 2: "#eaaf80", 4: "#ffffff" });
  // ASC is the default: only DESC reverses
  shape(heatTrack(assayContract({ e1: [1, 4] }, { sortOrder: "ASC" })), 0, 4, [0, 4], [W, DR]);
});

test("G12: two entities of one profile, A [1, 2], B [5, 8] -> both use the profile's range [0, 8] (DeU 720-749)", () => {
  const c = assayContract({ eA: [1, 2], eB: [5, 8] });
  const ts = heatTracks(c);
  assert.equal(ts.length, 2);
  const a = ts.find((t) => t.gene === "eA" || t.label.includes("eA"))!;
  const b = ts.find((t) => t.gene === "eB" || t.label.includes("eB"))!;
  assert.ok(a && b, "one track per entity");
  shape(a, 0, 8, [0, 8], [W, DR]);
  shape(b, 0, 8, [0, 8], [W, DR]);
  colourCells(c, a, { 1: "#faebdf", 2: "#f5d7bf" });
  colourCells(c, b, { 5: "#e59a60", 8: "#d55e00" });
});

test("G13: an entity with no value for a column -> our no-data cell, as a molecular heatmap's (OU 494)", () => {
  const c = assayContract({ e1: [1, null, 4] });
  const t = heatTrack(c);
  assert.equal(t.cells[1], -1, "no value: the no-data code");
  assert.ok(t.values![1] == null || Number.isNaN(t.values![1]), "no exact value");
  shape(t, 0, 4, [0, 4], [W, DR]);
  const ref = assayContract({ G: [0.5, null] }, { profileType: EXPR, assay: false });
  const refFill = drawn(ref, heatTrack(ref))[1].svg;
  assert.equal(drawn(c, t)[1].svg, refFill, "SVG fill of the no-data cell");
});

test("G14: the pivot's artificial bound cannot arise: a pivot at or past max is case 2, stops within [min, max], ends clamp (OU 393-396, 427, 441-464; RS)", () => {
  // pivot = max of the data
  let c = assayContract({ e1: [-4, 3] }, { pivot: 3 });
  let t = heatTrack(c);
  shape(t, -4, 3, [-4, 3], [DB, LB]);
  ends(t, DB, LB);
  colourCells(c, t, { "-4": "#0072b2", 3: "#ccecff" });
  // pivot beyond max: widened, then = max
  c = assayContract({ e1: [-4, 3] }, { pivot: 4 });
  t = heatTrack(c);
  shape(t, -4, 4, [-4, 4], [DB, LB]);
  colourCells(c, t, { "-4": "#0072b2", 3: "#b3ddf5" });
  // codes outside 0..255 never occur, but heatColor clamps to the end colours
  for (const tr of [t, heatTrack(assayContract({ e1: [-4, 3] }, { pivot: 1 }))]) {
    const s = (tr as AssayTrack).stops!;
    assert.ok(s.every((x) => x >= tr.min! && x <= tr.max!), "stops lie in [min, max]: " + s);
  }
});

test("G15: the legend (SVG) shows the track's range and its colours, a gradient bar from min to max (ours)", () => {
  for (const [vals, opts, lo, hi, text] of [
    [[-4, 3], { pivot: 1 }, DB, DR, /-4 → 3/],
    [[-1, 4], { sortOrder: "DESC" }, LB, DB, /-1 → 4/],
    [[1, 4], {}, W, DR, /0 → 4/]
  ] as [number[], { pivot?: number; sortOrder?: "DESC" }, Rgb, Rgb, RegExp][]) {
    const c = assayContract({ e1: vals }, opts);
    const svg = contractToSvg(c);
    const sw = svgRows(svg).filter((r) => r.w === 4 && r.h === 10);
    assert.equal(sw.length, 24, "one 24-swatch gradient bar");
    near(hex(sw[0].fill), toHex(lo), "legend bar at min");
    near(hex(sw[23].fill), toHex(hi), "legend bar at max");
    const legend = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).find((s) => s.includes(SIG));
    assert.ok(legend, "a legend line names the profile");
    assert.match(legend!.replace(/−/g, "-"), text, "the legend states the range");
  }
});

test("G15: the canvas legend (OncoprintFigure.tsx, HTML) draws heatColor at codes 0..255 between min and max (ours)", { skip: "React HTML legend, not reachable from node:test; it reads heatColor and t.min/t.max, which G1-G14 and the SVG row cover" }, () => {});

test("G16: a molecular (non-assay) heatmap is unchanged: fixed -3..3 / 0..1 ramps, no stops, pivot and sort order ignored (OU 220-286)", () => {
  for (const opts of [{}, { pivot: 1, sortOrder: "DESC" as const }]) {
    const e = heatTrack(assayContract({ G: [-10, 0, 25] }, { ...opts, profileType: EXPR, assay: false }));
    assert.equal(e.ramp, "expression");
    assert.deepEqual([e.min, e.max], [-3, 3]);
    assert.equal(e.stops, undefined, "no stops");
    near(hex(heatColor(e as never, 0)), "#0000ff", "expression code 0");
    near(hex(heatColor(e as never, 255)), "#ff0000", "expression code 255");
    const m = heatTrack(assayContract({ G: [0.4, 0.6] }, { ...opts, profileType: METH, assay: false }));
    assert.equal(m.ramp, "methylation");
    assert.deepEqual([m.min, m.max], [0, 1]);
    assert.equal(m.stops, undefined, "no stops");
  }
  // and an assay track has no fixed ramp (OU 231-232)
  assert.equal(heatTrack(assayContract({ e1: [1, 4] })).ramp, undefined);
});

test("G17: Python port -> the same range and colours (conformance)", { skip: "python/tests/test_assay_colours.py runs G1-G12 and G16 against assemble_contract / heat_rgb" }, () => {});
