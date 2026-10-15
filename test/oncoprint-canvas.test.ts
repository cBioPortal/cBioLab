// The browser renderer's geometry, against a context that records what it is asked to fill.
// Columns drawn at fractional device pixels each antialias their edge against the paper, and the
// paper shows through as a seam every few columns: banding across every row. Every cell edge must
// land on a device pixel, and neighbours must meet, at any zoom and any pixel ratio.
import test from "node:test";
import assert from "node:assert/strict";
import { draw, fitZoom, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
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
