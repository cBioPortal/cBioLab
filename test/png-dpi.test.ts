import test from "node:test";
import assert from "node:assert/strict";
import { setPngDpi } from "../lib/png-dpi.ts";

// A minimal but valid PNG: signature + IHDR (1x1, 8-bit RGBA) + IEND. Real enough to prove the
// pHYs chunk lands in a spot a real decoder would accept: right after IHDR, before anything else.
function minimalPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89];
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  return new Uint8Array([...sig, ...ihdr, ...iend]);
}

test("setPngDpi inserts a 21-byte pHYs chunk right after IHDR", () => {
  const png = minimalPng();
  const out = setPngDpi(png, 150);
  assert.equal(out.length, png.length + 21);
  // length(4) + "pHYs"(4) at byte 33
  assert.deepEqual(Array.from(out.subarray(33, 37)), [0, 0, 0, 9]);
  assert.equal(new TextDecoder().decode(out.subarray(37, 41)), "pHYs");
  // 150 dpi -> round(150 / 0.0254) pixels per meter, big-endian, twice (x and y)
  const ppm = Math.round(150 / 0.0254);
  const dv = new DataView(out.buffer, out.byteOffset + 41, 8);
  assert.equal(dv.getUint32(0), ppm);
  assert.equal(dv.getUint32(4), ppm);
  assert.equal(out[49], 1); // unit specifier: meters
  // everything from IHDR's end onward in the original file follows the new chunk, untouched
  assert.deepEqual(Array.from(out.subarray(54)), Array.from(png.subarray(33)));
});

test("the pHYs chunk's CRC is valid over its type+data", () => {
  const out = setPngDpi(minimalPng(), 96);
  const type = out.subarray(37, 41), data = out.subarray(41, 50), crc = new DataView(out.buffer, out.byteOffset + 50, 4).getUint32(0);
  // recompute the same CRC-32 independently (the classic PNG/zlib polynomial table)
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let c = 0xffffffff;
  for (const b of [...type, ...data]) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  assert.equal(crc, (c ^ 0xffffffff) >>> 0);
});
