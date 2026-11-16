// A heatmap cell that was profiled but has no value: the VAF row's "Not mutated/no VAF data".
// The portal draws a VAF datum for every sample profiled for the gene's mutations, its value the
// max VAF of its mutations in the gene, null when there is none (OncoprintUtils
// createHeatmapTracksData 643-780); a null is drawn in the rule set's null_color, #e0e0e0, white
// with "white background" on, keyed "Not mutated/no VAF data" (OncoprintUtils 220-285), while a
// sample with no datum is na, the not-profiled glyph (DataUtils fillHeatmapTrackDatum 385-470).
// Ours: a heatmap cell is a value (0..255), −1 not profiled, or −2 (HEAT_NULL) profiled with no value.
// Case ids are the case table's (V1…); V2, V4–V6 and V8–V10 are checked against the fixture
// database, not here.
import test from "node:test";
import assert from "node:assert/strict";
import * as assemble from "../lib/oncoprint-assemble.ts";
import { assembleContract, normalizeDisplay, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { vafSql } from "../lib/oncoprint.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { contractToTsv } from "../lib/oncoprint-tabular.ts";
import { clusterHeatmap } from "../lib/oncoprint-cluster.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { draw, sortColumns, paletteOf, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { STYLE, styleForDisplay, resolveStyle } from "../lib/oncoprint-style.ts";
import { heatmapTrackLabel } from "../lib/profile-names.ts";
import type { Contract, Track } from "../lib/types.ts";

const HEAT_NULL = (assemble as Record<string, unknown>).HEAT_NULL as number;
const GREY = "#e0e0e0", WHITE = "#ffffff";

/** any CSS colour this code writes, as lower-case #rrggbb */
function hex(c: unknown): string {
  const s = String(c).trim().toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((x) => x + x).join("");
  return s;
}

/**
 * KRAS profiled for mutations in P1..P8 except P3 and P7; P2 and P5 profiled with no VAF (NaN),
 * P8 a mutation with alt 0 (VAF 0). `extra` adds rows of other profiles.
 */
const VAF: Record<string, number | undefined> = { P1: 0.5, P2: NaN, P3: undefined, P4: 0.1, P5: NaN, P6: 0.9, P7: undefined, P8: 0 };
const PIDS = Object.keys(VAF);
const vafInput = (sort: AssembleInput["sort"] = [], values: Record<string, number | undefined> = VAF, extra: AssembleInput["heatmap"] = []): AssembleInput => ({
  genes: ["KRAS"], groups: [{ name: "all", pids: Object.keys(values) }], studies: ["s"], events: [],
  coverage: Object.keys(values).map((pid) => ({ pid, genes: ["KRAS"] })), isDriver: () => false, annotationSource: "t",
  clinical: [], derived: [], sort, lineGap: 0, display: normalizeDisplay({}),
  heatmap: [{ profileType: "VAF", genes: ["KRAS"], isVaf: true,
    values: new Map(Object.entries(values).filter(([, v]) => v !== undefined).map(([p, v]): [string, number] => [p + "|KRAS", v!])) }, ...extra]
});
const LABEL = heatmapTrackLabel("KRAS", "VAF");
const vafTrack = (c: Contract): Track => {
  const t = c.tracks.find((x) => x.kind === "heatmap" && x.ramp === "vaf");
  assert.ok(t, "a VAF heatmap row: " + c.tracks.map((x) => x.kind + " " + x.label).join(", "));
  return t!;
};
const unpack = (c: Contract) => { const buf = packContract(c); return unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer); };

// ---- assembly ---------------------------------------------------------------------------------

test("HEAT_NULL is exported and is −2", () => {
  assert.equal(HEAT_NULL, -2);
});

test("V1: a column profiled for the gene's mutations with no VAF is HEAT_NULL; its value null (OU 643-780, DU 385-470)", () => {
  const c = assembleContract(vafInput());
  const t = vafTrack(c), at = (p: string) => c.columns.indexOf(p);
  for (const p of ["P2", "P5"]) {
    assert.equal(t.cells[at(p)], HEAT_NULL, p + ": profiled, no value");
    assert.equal(t.values![at(p)], null, p + ": no value in the contract");
  }
});

test("V1: a gene profiled everywhere and mutated nowhere is still a VAF row, every cell HEAT_NULL", () => {
  const none = Object.fromEntries(PIDS.map((p): [string, number] => [p, NaN]));
  const c = assembleContract(vafInput([], none));
  const t = vafTrack(c);
  assert.equal(t.kind, "heatmap", "not the '(no data)' row: every column was profiled");
  assert.deepEqual(Array.from(t.cells), PIDS.map(() => HEAT_NULL));
  assert.deepEqual(Array.from(t.values!), PIDS.map(() => null));
});

test("V3: a VAF of 0 (alt 0, ref > 0) is a value: cell 0, value 0, not HEAT_NULL (MU 389)", () => {
  const c = assembleContract(vafInput());
  const t = vafTrack(c), i = c.columns.indexOf("P8");
  assert.equal(t.cells[i], 0);
  assert.equal(t.values![i], 0);
});

test("V7: a column not profiled for the gene's mutations is −1, not HEAT_NULL (DU 404-406)", () => {
  const c = assembleContract(vafInput());
  const t = vafTrack(c);
  for (const p of ["P3", "P7"]) {
    assert.equal(t.cells[c.columns.indexOf(p)], -1, p);
    assert.equal(t.values![c.columns.indexOf(p)], null, p);
  }
});

test("V7/V1: the values keep their ramp codes beside HEAT_NULL and −1", () => {
  const c = assembleContract(vafInput());
  const t = vafTrack(c), at = (p: string) => t.cells[c.columns.indexOf(p)];
  assert.equal(at("P1"), Math.round(255 * 0.5)); assert.equal(at("P4"), Math.round(255 * 0.1)); assert.equal(at("P6"), Math.round(255 * 0.9));
});

test("V13: expression and methylation rows, whose values are numbers or absent, never produce HEAT_NULL", () => {
  const vals = new Map([["P1|KRAS", 1.5], ["P4|KRAS", -0.5], ["P6|KRAS", 0]]);
  const meth = new Map([["P1|KRAS", 0.2], ["P2|KRAS", 0.9]]);
  const c = assembleContract(vafInput([], VAF, [
    { profileType: "mrna_zscore", genes: ["KRAS"], isVaf: false, values: vals },
    { profileType: "methylation_hm450", genes: ["KRAS"], isVaf: false, values: meth }]));
  const others = c.tracks.filter((t) => t.kind === "heatmap" && t.ramp !== "vaf");
  assert.equal(others.length, 2);
  for (const t of others) {
    assert.ok(!Array.from(t.cells).includes(HEAT_NULL), t.label + ": " + Array.from(t.cells).join(","));
    assert.ok(!Array.from(t.cells).some((x) => x < -1 || Number.isNaN(x)), t.label);
  }
});

// ---- the VAF query (text only; V2–V10 are run against the fixture database) -----------------

test("V1/V7: the VAF query reads the mutation profiles' gene panels", () => {
  for (const unit of ["patient", "sample"] as const) {
    const sql = vafSql(["KRAS"], "s", "db", unit);
    assert.match(sql, /sample_to_gene_panel_derived/, unit);
    assert.match(sql, /alteration_type\s*=\s*'MUTATION_EXTENDED'/, unit);
  }
});

test("V3: the VAF query keeps alt 0 (no tumorAltCount > 0 filter remains)", () => {
  for (const unit of ["patient", "sample"] as const) {
    const sql = vafSql(["KRAS"], "s", "db", unit);
    assert.doesNotMatch(sql, /tumorAltCount\s*>\s*0/, unit);
  }
});

// ---- SVG ------------------------------------------------------------------------------------

/** the fills of every rect in the given track's row, inside the plot */
function svgRow(svg: string, ti: number): { fill: string; y: number; h: number }[] {
  const G = STYLE.geometry, y0 = G.header + ti * (G.rowH + G.rowGap);
  const out: { fill: string; y: number; h: number }[] = [];
  for (const m of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"\/>/g)) {
    const x = +m[1], y = +m[2], h = +m[4];
    if (x >= G.gutter && y >= y0 - 1e-6 && y < y0 + G.rowH - 1e-6) out.push({ fill: hex(m[5]), y, h });
  }
  return out;
}

test("V11 (SVG): a HEAT_NULL cell is a full cell filled #e0e0e0, with no not-profiled midline (OU 273-275)", () => {
  const c = assembleContract(vafInput());
  const ti = c.tracks.indexOf(vafTrack(c));
  const row = svgRow(contractToSvg(c, 1200), ti);
  const grey = row.filter((r) => r.fill === GREY);
  assert.equal(grey.length, 2, "one #e0e0e0 rect per HEAT_NULL column: " + JSON.stringify(row));
  for (const r of grey) assert.equal(r.h, STYLE.geometry.rowH, "the whole cell");
  const stripe = hex(STYLE.glyph.notProfiled.stripe.color);
  assert.equal(row.filter((r) => r.fill === stripe).length, 2, "the midline only on the two not-profiled columns");
});

test("V11 (SVG): with display.whiteBackground a HEAT_NULL cell is #ffffff, still with no midline (OU 273-275)", () => {
  const c = assembleContract(vafInput());
  const white = { ...c, display: { ...c.display, whiteBackground: true } } as Contract;
  const ti = c.tracks.indexOf(vafTrack(c));
  const row = svgRow(contractToSvg(white, 1200), ti);
  assert.equal(row.filter((r) => r.fill === GREY).length, 0, "no grey with white background");
  const stripe = hex(STYLE.glyph.notProfiled.stripe.color);
  assert.equal(row.filter((r) => r.fill === stripe).length, 2, "the midline only on the two not-profiled columns");
  assert.equal(row.filter((r) => r.fill === WHITE && r.h === STYLE.geometry.rowH).length, 4, "two not-profiled and two HEAT_NULL cells, all white");
});

test("V12: the VAF row's legend keys HEAT_NULL as a #e0e0e0 swatch 'Not mutated/no VAF data' (OU 246-247)", () => {
  const c = assembleContract(vafInput());
  const svg = contractToSvg(c, 1200);
  assert.match(svg, />Not mutated\/no VAF data<\/text>/);
  // the swatch: a 10px #e0e0e0 square below the rows
  const G = STYLE.geometry, below = G.header + c.tracks.length * (G.rowH + G.rowGap);
  const swatches = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="10" height="10" fill="([^"]+)"\/>/g)]
    .filter((m) => +m[1] >= below && hex(m[2]) === GREY);
  assert.equal(swatches.length, 1, "one grey swatch in the legend");
});

test("V12: a VAF row with no HEAT_NULL cell has no 'Not mutated/no VAF data' key", () => {
  const values = { P1: 0.5, P2: 0.2, P3: undefined };
  const svg = contractToSvg(assembleContract(vafInput([], values)), 1200);
  assert.doesNotMatch(svg, /Not mutated\/no VAF data/);
});

test("V13: a HEAT_NULL in an expression or methylation row draws #e0e0e0 too, with no legend label (OU 273)", () => {
  const vals = new Map([["P1|KRAS", 1.5], ["P4|KRAS", -0.5], ["P6|KRAS", 0]]);
  const base = assembleContract({ ...vafInput(), heatmap: [{ profileType: "mrna_zscore", genes: ["KRAS"], isVaf: false, values: vals }] });
  const ti = base.tracks.findIndex((t) => t.kind === "heatmap");
  const t = base.tracks[ti];
  const cells = Array.from(t.cells); cells[base.columns.indexOf("P2")] = -2;
  const c = { ...base, tracks: base.tracks.map((x, i) => i === ti ? { ...x, cells } : x) } as Contract;
  const svg = contractToSvg(c, 1200);
  assert.equal(svgRow(svg, ti).filter((r) => r.fill === GREY).length, 1);
  assert.doesNotMatch(svg, /Not mutated\/no VAF data/);
});

// ---- canvas ---------------------------------------------------------------------------------

/** a 2D context that records every fillRect with the fill it was drawn in */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  let fill = "";
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillRect") return (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h, fill: hex(fill) });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "fillStyle") return fill;
      return () => {};
    },
    set(_t, k, v) { if (k === "fillStyle") fill = String(v); return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rects };
}

function canvasRow(c: Contract, whiteBackground: boolean) {
  const data = unpack(c);
  const ti = data.tracks.findIndex((t) => t.kind === "heatmap");
  const S = styleForDisplay(resolveStyle(undefined), { whiteBackground });
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: data.n, patients: data.n }];
  const { ctx, rects } = recorder();
  draw(ctx, data, Uint32Array.from({ length: data.n }, (_, i) => i), groups, { zoom: 20, scrollX: 0, whitespace: false }, 1200,
    paletteOf(S), { gap: 0, style: S });
  const y0 = GEOM.header + ti * (GEOM.rowH + GEOM.rowGap);
  return rects.filter((r) => r.x >= GEOM.gutter && r.y >= y0 - 1e-6 && r.y < y0 + GEOM.rowH - 1e-6);
}

test("V11 (canvas): a HEAT_NULL cell is a full cell filled #e0e0e0, with no midline (OU 273-275)", () => {
  const row = canvasRow(assembleContract(vafInput()), false);
  const grey = row.filter((r) => r.fill === GREY);
  assert.equal(grey.length, 2, "one #e0e0e0 fill per HEAT_NULL column: " + JSON.stringify(row.map((r) => r.fill)));
  for (const r of grey) assert.equal(r.h, GEOM.rowH);
  const stripe = hex(STYLE.glyph.notProfiled.stripe.color);
  assert.equal(row.filter((r) => r.fill === stripe).length, 2, "the midline only on the two not-profiled columns");
});

test("V11 (canvas): with white background a HEAT_NULL cell is #ffffff, no midline", () => {
  const row = canvasRow(assembleContract(vafInput()), true);
  assert.equal(row.filter((r) => r.fill === GREY).length, 0);
  const stripe = hex(STYLE.glyph.notProfiled.stripe.color);
  assert.equal(row.filter((r) => r.fill === stripe).length, 2);
  assert.equal(row.filter((r) => r.fill === WHITE && r.h === GEOM.rowH).length, 4, "two not-profiled and two HEAT_NULL cells, all white");
});

// ---- sorting --------------------------------------------------------------------------------

// values ascending: P8 0, P4 0.1, P1 0.5, P6 0.9; HEAT_NULL: P2, P5; not profiled: P3, P7
const slots = (order: string[]) => [order.slice(0, 4), new Set(order.slice(4, 6)), new Set(order.slice(6, 8))];
const EXPECT = {
  asc: [["P8", "P4", "P1", "P6"], new Set(["P2", "P5"]), new Set(["P3", "P7"])],
  desc: [["P6", "P1", "P4", "P8"], new Set(["P2", "P5"]), new Set(["P3", "P7"])]
};

for (const dir of ["asc", "desc"] as const) {
  test(`V14 (engine, ${dir}): values by value, then HEAT_NULL, then not profiled`, () => {
    const c = assembleContract(vafInput([{ track: LABEL, dir }]));
    assert.deepEqual(slots(c.columns), EXPECT[dir], c.columns.join(" "));
  });

  test(`V14 (browser, ${dir}): sortColumns puts values by value, then HEAT_NULL, then not profiled`, () => {
    const data = unpack(assembleContract(vafInput([{ track: "id", dir: "asc" }])));
    const order = Uint32Array.from({ length: data.n }, (_, i) => i), ids = data.columns();
    const sorted = Array.from(sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], [{ track: LABEL, dir }]), (i) => ids[i]);
    assert.deepEqual(slots(sorted), EXPECT[dir], sorted.join(" "));
  });
}

// ---- tabular download -----------------------------------------------------------------------

test("V17: the Tabular download writes \"\" for a HEAT_NULL cell, as for −1 (TD 222)", () => {
  const c = assembleContract(vafInput());
  const lines = contractToTsv(c).trim().split("\n").map((l) => l.split("\t"));
  const head = lines[0];
  const row = lines.find((l) => l[0] === "KRAS" && l[1].startsWith("HEATMAP"));
  assert.ok(row, lines.map((l) => l.slice(0, 2).join(" ")).join("; "));
  const at = (p: string) => row![head.indexOf(p)];
  assert.equal(at("P2"), ""); assert.equal(at("P5"), "");
  assert.equal(at("P3"), ""); assert.equal(at("P7"), "");
  assert.equal(at("P1"), "0.5"); assert.equal(at("P8"), "0");
});

// ---- clustering -----------------------------------------------------------------------------

test("V18: clustering takes a profiled-but-no-value column (NaN) as no value, placed with the missing", () => {
  // the VAF profile's values reach clusterHeatmap as NaN for HEAT_NULL and for not profiled alike
  // (lib/oncoprint.ts builds its rows from the same values map)
  const cols = [[0.1, 0.2], [NaN, NaN], [0.9, 0.1], [0.5, 0.7], [NaN, NaN], [0.3, 0.3]];
  const rows = cols[0].map((_, d) => Float64Array.from(cols.map((c) => c[d])));
  const { order, method } = clusterHeatmap({ rows, n: cols.length });
  assert.deepEqual(new Set(order.slice(-2)), new Set([1, 4]), order.join(","));
  assert.equal(method.noData, 2);
});

// a pixel holding several columns (lib/oncoprint-lod.ts aggregate): a profiled cell without a value is no value
test("zoomed out: a pixel's mean leaves out -2; all -2 (or -2 and -1) is -2; all -1 is -1", async () => {
  const { aggregate } = await import("../lib/oncoprint-lod.ts");
  const t = { kind: "heatmap", numeric: true } as never, scratch = new Int32Array(8);
  const px = (cells: number[]) => aggregate(t, cells, null, 0, cells.length, scratch);
  assert.equal(px([-2, 100, 200]), 150);
  assert.equal(px([-2, -2]), -2);
  assert.equal(px([-2, -1]), -2);
  assert.equal(px([-1, -1]), -1);
});
