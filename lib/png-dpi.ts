// canvas.toBlob("image/png") writes bare pixels: nothing in the file says how big that should
// print. Embedding a pHYs chunk gives print/office tools (Word, Photoshop, Preview) a physical
// size to honor instead of falling back to a 72 or 96 dpi guess.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32be(n: number): Uint8Array { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }

/**
 * Insert a pHYs chunk declaring `dpi`, right after IHDR (always the PNG's first chunk, and
 * always exactly 13 bytes of data — 8-byte signature + 4-byte length + 4-byte type + 13-byte
 * data + 4-byte CRC = 33 bytes — so this offset needs no chunk parsing).
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254); // pixels per meter, the unit pHYs requires
  const type = new TextEncoder().encode("pHYs");
  const data = new Uint8Array(9);
  data.set(u32be(ppm), 0); data.set(u32be(ppm), 4); data[8] = 1; // 1 = unit is meters
  const crcInput = new Uint8Array(type.length + data.length);
  crcInput.set(type); crcInput.set(data, type.length);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  chunk.set(u32be(9), 0); chunk.set(type, 4); chunk.set(data, 8); chunk.set(u32be(crc32(crcInput)), 17);
  const IHDR_END = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, IHDR_END), 0);
  out.set(chunk, IHDR_END);
  out.set(png.subarray(IHDR_END), IHDR_END + chunk.length);
  return out;
}
