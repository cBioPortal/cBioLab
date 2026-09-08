// OPB1 transport: a contract survives pack -> unpack with cells as typed arrays,
// dtype widening when a cell exceeds 16 bits, and lazy column decoding.
import test from "node:test";
import assert from "node:assert/strict";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { Contract } from "../lib/types.ts";

const contract = (cells: number[][]): Contract => ({
  study: "s", studies: ["s"], unit: "patient",
  groups: [{ name: "a", start: 0, count: 2 }, { name: "b", start: 2, count: 1 }],
  columns: ["P-1", "P-2", "P-3"],
  tracks: [
    { kind: "gene", label: "TP53", cells: cells[0], altered: 1, profiled: 2, driverAltered: 1, freqPct: 50, driverPct: 50 },
    { kind: "clinical", label: "AGE", numeric: true, min: 10, max: 90, cells: cells[1] },
    { kind: "clinical", label: "TYPE", categories: ["x", "y"], cells: cells[2] }
  ],
  conventions: { cna: "c", notProfiled: "n", frequencyDenominator: "profiled", annotation: "OncoKB", lineGap: 90, sort: ["genomic"] },
  display: { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all" },
  stats: { nColumns: 3, ms: 1 }
});

test("pack/unpack round-trips cells, metadata and columns", () => {
  const c = contract([[257, 0, -1], [0, 255, -1], [1, 0, -1]]);
  const buf = packContract(c);
  const u = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  assert.equal(u.n, 3);
  assert.deepEqual(u.groups, c.groups);
  assert.deepEqual(u.columns(), ["P-1", "P-2", "P-3"]);
  assert.equal(u.tracks.length, 3);
  assert.ok(u.tracks[0].cells instanceof Int16Array);
  assert.deepEqual(Array.from(u.tracks[0].cells), [257, 0, -1]);
  assert.equal(u.tracks[0].freqPct, 50);
  assert.equal(u.tracks[1].min, 10);
  assert.deepEqual(u.tracks[2].categories, ["x", "y"]);
  assert.equal(u.conventions.annotation, "OncoKB");
  assert.deepEqual(u.display, c.display, "viewing options survive the wire");
  assert.equal((u.tracks[0] as { cells?: unknown; dtype?: unknown }).dtype, undefined);
});

test("a track with a cell beyond 16 bits is widened to i32 without disturbing its neighbours", () => {
  const c = contract([[1 << 20, 0, -1], [0, 255, -1], [1, 0, -1]]);
  const buf = packContract(c);
  const u = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  assert.ok(u.tracks[0].cells instanceof Int32Array);
  assert.equal(u.tracks[0].cells[0], 1 << 20);
  assert.ok(u.tracks[1].cells instanceof Int16Array);
  assert.deepEqual(Array.from(u.tracks[2].cells), [1, 0, -1]);
});

test("cells cost exactly 2 bytes each and unpack is zero-copy over the response buffer", () => {
  const n = 100000;
  const cells = Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 257 : 0));
  const ids = Array.from({ length: n }, (_, i) => "P-" + i);
  const c: Contract = { ...contract([[0], [0], [0]]), columns: ids, groups: [{ name: "a", start: 0, count: n }],
    tracks: [{ kind: "gene", label: "TP53", cells }, { kind: "gene", label: "KRAS", cells }], stats: { nColumns: n, ms: 0 } };
  const packed = packContract(c);
  const idBytes = ids.join("\n").length;
  const overhead = packed.byteLength - 2 * n * 2 - idBytes;
  assert.ok(overhead > 0 && overhead < 2048, "header overhead " + overhead + " bytes");
  const buf = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
  const u = unpackContract(buf);
  assert.equal(u.tracks[0].cells.buffer, buf, "typed arrays must view the response buffer, not copy it");
  assert.equal(u.tracks[0].cells[7], 257);
});

test("rejects a payload that is not OPB1", () => {
  assert.throws(() => unpackContract(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer), /OPB1/);
});
