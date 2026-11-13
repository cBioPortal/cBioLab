// The browser renderer's geometry, against a context that records what it is asked to fill.
// Columns drawn at fractional device pixels each antialias their edge against the paper, and the
// paper shows through as a seam every few columns: banding across every row. Every cell edge must
// land on a device pixel, and neighbours must meet, at any zoom and any pixel ratio.
import test from "node:test";
import assert from "node:assert/strict";
import { draw, fitZoom, sortColumns, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { assembleContract, normalizeDisplay, type EventRow } from "../lib/oncoprint-assemble.ts";

function recorder(dpr: number) {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: dpr });
      if (k === "fillRect") return (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h });
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set() { return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rects };
}

function figure(n: number) {
  const pids = Array.from({ length: n }, (_, i) => "P" + i);
  const c = assembleContract({ genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"], events: [],
    coverage: pids.map((pid) => ({ pid, genes: ["G"] })), isDriver: () => false, annotationSource: "t",
    clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0 });
  const buf = packContract(c);
  return unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

for (const dpr of [1, 1.25, 1.5, 2]) for (const [label, n, zoom] of [["zoomed out", 5000, 0], ["fractional zoom", 400, 1.7], ["with gaps", 120, 7.3]] as const) {
  test(`cells meet on device pixels: ${label}, pixel ratio ${dpr}`, () => {
    const data = figure(n);
    const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
    const cssW = 1351;
    const z = zoom || fitZoom(groups, cssW - GEOM.gutter, 0);
    const { ctx, rects } = recorder(dpr);
    draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), groups, { zoom: z, scrollX: 0, whitespace: true }, cssW, undefined, { gap: 0 });
    const y = GEOM.header;
    // the gene row's base fills, left to right
    const row = rects.filter((r) => Math.abs(r.y - Math.round(y * dpr) / dpr) < 1e-9 && r.h === GEOM.rowH && r.x >= GEOM.gutter).sort((a, b) => a.x - b.x);
    assert.ok(row.length > 50, "drew the row");
    const onPixel = (v: number) => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6;
    for (const r of row) assert.ok(onPixel(r.x) && onPixel(r.x + r.w), `edge at ${r.x}..${r.x + r.w} is between device pixels`);
    const gaps = new Set<number>();
    for (let i = 1; i < row.length; i++) gaps.add(Math.round((row[i].x - (row[i - 1].x + row[i - 1].w)) * dpr));
    assert.ok(gaps.size === 1, `gaps between cells vary (${[...gaps].join(", ")} device px): that is banding`);
  });
}

test("the browser's genomic re-sort is the engine's staircase, ids in the portal's natural order", () => {
  const pids = ["P10", "P2", "TCGA-AA-3864", "TCGA-AA-A00N", "A", "B", "C", "D", "E", "G"];
  const ev = (pid: string, gene: string, vt: string, mt?: string, cna?: number, driver = false) => ({ pid, gene, vt, mt, cna, driver });
  const build = (sort: { track: string; dir: "asc" | "desc" }[]) => assembleContract({ genes: ["TP53", "KRAS"], groups: [{ name: "all", pids }], studies: ["s"],
    events: [ev("A", "TP53", "mutation", "Nonsense_Mutation"), ev("B", "TP53", "mutation", "Missense_Mutation", undefined, true),
      ev("C", "TP53", "cna", undefined, 2), ev("D", "TP53", "cna", undefined, 2), ev("D", "TP53", "mutation", "Missense_Mutation", undefined, true),
      ev("E", "TP53", "cna", undefined, -2, true), ev("G", "KRAS", "mutation", "Missense_Mutation", undefined, true)],
    coverage: pids.map((pid) => ({ pid, genes: pid === "G" ? ["KRAS"] : ["TP53", "KRAS"] })),
    isDriver: (r) => !!(r as { driver?: boolean }).driver, annotationSource: "t", clinical: [], heatmap: [], derived: [], sort, lineGap: 0 });
  const engine = build([{ track: "genomic", dir: "asc" }]);
  const byId = build([{ track: "id", dir: "desc" }]);
  const buf = packContract(byId);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i);
  const sorted = sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], [{ track: "genomic", dir: "asc" }]);
  const ids = data.columns();
  assert.deepEqual(Array.from(sorted, (i) => ids[i]), engine.columns);
  assert.deepEqual(engine.columns, ["E", "D", "C", "B", "A", "P2", "P10", "TCGA-AA-A00N", "TCGA-AA-3864", "G"]);
});

test("the browser re-sorts with the Sort switches as the engine does", () => {
  const pids = ["A", "B", "C", "D"];
  const build = (display: Record<string, unknown>) => assembleContract({ genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"],
    events: [{ pid: "A", gene: "TP53", vt: "mutation", mt: "Nonsense_Mutation" }, { pid: "B", gene: "TP53", vt: "mutation", mt: "Missense_Mutation", driver: true },
      { pid: "D", gene: "TP53", vt: "mutation", mt: "In_Frame_Del" }] as EventRow[],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })), isDriver: (r) => !!(r as { driver?: boolean }).driver, annotationSource: "t",
    clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0, display: normalizeDisplay(display) });
  const base = build({});
  const buf = packContract(base);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i), ids = data.columns();
  const groups = [{ name: "all", start: 0, count: data.n, patients: data.n }];
  for (const [display, switches] of [[{ sortByDrivers: false }, { byDriver: false }], [{ sortIgnoreVUS: true }, { ignoreVus: true }]] as const) {
    const sorted = sortColumns(data, order, groups, [{ track: "genomic", dir: "asc" }], switches);
    assert.deepEqual(Array.from(sorted, (i) => ids[i]), build(display).columns, JSON.stringify(display));
  }
});
