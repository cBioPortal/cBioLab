// The browser renderer's geometry, against a context that records what it is asked to fill.
// Columns drawn at fractional device pixels each antialias their edge against the paper, and the
// paper shows through as a seam every few columns: banding across every row. Every cell edge must
// land on a device pixel, and neighbours must meet, at any zoom and any pixel ratio.
import test from "node:test";
import assert from "node:assert/strict";
import { draw, fitZoom, fitAlteredView, PORTAL_FULL_ZOOM, sortColumns, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { assembleContract } from "../lib/oncoprint-assemble.ts";

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

test("the initial zoom fits the altered columns, at most the portal's 100 % (ONC-ZM-2, ONC-STM-13)", () => {
  const view = (n: number, altered: string[], groups?: string[][]) => {
    const pids = Array.from({ length: n }, (_, i) => "P" + String(i).padStart(4, "0"));
    const gs = groups ? groups.map((g, i) => ({ name: "g" + i, pids: g })) : [{ name: "all", pids }];
    const c = assembleContract({ genes: ["G"], groups: gs, studies: ["s"],
      events: altered.map((pid) => ({ pid, gene: "G", vt: "mutation", mt: "Missense_Mutation" })),
      coverage: pids.map((pid) => ({ pid, genes: ["G"] })), isDriver: () => false, annotationSource: "t",
      clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0 });
    const buf = packContract(c);
    const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const order = Uint32Array.from({ length: data.n }, (_, i) => i);
    let start = 0;
    const vg: VisibleGroup[] = c.groups.map((g) => { const r = { name: g.name, start, count: g.count, patients: g.count }; start += g.count; return r; });
    return { data, order, vg };
  };
  // 594 columns, 485 altered (sorted first) in 1,000 px: the altered span fills the plot
  const q1 = view(594, Array.from({ length: 485 }, (_, i) => "P" + String(i).padStart(4, "0")));
  const z1 = fitAlteredView(q1.data, q1.order, q1.vg, 1000);
  assert.ok(Math.abs(z1.zoom - 1000 / 485) < 1e-9 && z1.scrollX === 0);
  assert.ok(z1.zoom > fitZoom(q1.vg, 1000), "closer than fitting every column");
  // a few altered columns: no closer than the portal's 100 %
  const few = view(1000, ["P0000", "P0001"]);
  assert.equal(fitAlteredView(few.data, few.order, few.vg, 1000).zoom, PORTAL_FULL_ZOOM);
  // nothing altered: 100 %, but never below fitting every column
  const none = view(50, []);
  assert.equal(fitAlteredView(none.data, none.order, none.vg, 1000).zoom, fitZoom(none.vg, 1000));
  const noneBig = view(5000, []);
  assert.equal(fitAlteredView(noneBig.data, noneBig.order, noneBig.vg, 1000).zoom, PORTAL_FULL_ZOOM);
  // the altered span in a second group: scrolled to its start, the gap inside the span counted
  const ids = Array.from({ length: 400 }, (_, i) => "P" + String(i).padStart(4, "0"));
  const two = view(400, ["P0250", "P0300"], [ids.slice(0, 200), ids.slice(200)]);
  const z2 = fitAlteredView(two.data, two.order, two.vg, 600, 10);
  assert.equal(z2.zoom, PORTAL_FULL_ZOOM);
  assert.ok(z2.scrollX > 200 * PORTAL_FULL_ZOOM, "starts at the first altered column, in the second group");
});

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
