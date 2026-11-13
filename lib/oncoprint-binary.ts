// Binary transport for the oncoprint render contract.
//
// Layout:  "OPB1" | u32 headerBytes | header JSON (padded to 4 bytes) | cell arrays | column ids
// The header is the contract minus the two bulk fields (`tracks[].cells`, `columns`);
// each track carries `dtype`, `offset` (bytes from payload start) and `length`; a numeric track's
// exact values follow its cells as little-endian float32 at `valuesOffset`.
// Column ids are one UTF-8 string joined by "\n" at `columnsOffset`.
//
// Isomorphic: `packContract` runs on the server, `unpackContract` in the browser.
// Nothing here knows about the database or the DOM.
import type { Contract, Track } from "./types.ts";

const MAGIC = 0x4f504231; // "OPB1"

export type CellDtype = "i16" | "i32";
export interface PackedTrackMeta extends Omit<Track, "cells" | "values"> { dtype: CellDtype; offset: number; length: number; valuesOffset?: number }
export interface PackedHeader extends Omit<Contract, "tracks" | "columns"> {
  n: number;
  tracks: PackedTrackMeta[];
  columnsOffset: number;
  columnsBytes: number;
  format: "OPB1";
}
export interface UnpackedContract extends Omit<Contract, "tracks" | "columns"> {
  /** `display` and `queries` ride in the header, so a renderer sees them without the cells */
  n: number;
  tracks: (Omit<Track, "cells" | "values"> & { cells: Int16Array | Int32Array; values?: Float32Array })[];
  /** decoded lazily — 200k ids are only needed for tooltips and exports */
  columns: () => string[];
}

const pad4 = (n: number): number => (n + 3) & ~3;

export function packContract(contract: Contract): Uint8Array {
  const n = contract.columns.length;
  const enc = new TextEncoder();
  const colBytes = enc.encode(contract.columns.join("\n"));

  // per-track dtype: i16 unless a cell needs more (the bitmask has room to grow)
  const metas: PackedTrackMeta[] = [];
  let cursor = 0;
  for (const t of contract.tracks) {
    const cells = t.cells;
    let wide = false;
    for (let i = 0; i < cells.length; i++) { const c = cells[i]; if (c > 32767 || c < -32768) { wide = true; break; } }
    const dtype: CellDtype = wide ? "i32" : "i16";
    const bytes = cells.length * (wide ? 4 : 2);
    const { cells: _omit, values, ...meta } = t;
    const m: PackedTrackMeta = { ...meta, dtype, offset: cursor, length: cells.length };
    cursor += pad4(bytes);
    if (values) { m.valuesOffset = cursor; cursor += values.length * 4; }
    metas.push(m);
  }
  const columnsOffset = cursor;
  const payloadBytes = columnsOffset + colBytes.length;

  const { tracks: _t, columns: _c, ...rest } = contract;
  const header: PackedHeader = { ...rest, n, tracks: metas, columnsOffset, columnsBytes: colBytes.length, format: "OPB1" };
  const headerBytes = enc.encode(JSON.stringify(header));
  const headerPadded = pad4(headerBytes.length);

  const out = new Uint8Array(8 + headerPadded + payloadBytes);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC);
  dv.setUint32(4, headerBytes.length);
  out.set(headerBytes, 8);
  const base = 8 + headerPadded;
  contract.tracks.forEach((t, ti) => {
    const m = metas[ti];
    if (m.dtype === "i16") new Int16Array(out.buffer, base + m.offset, m.length).set(t.cells as ArrayLike<number>);
    else new Int32Array(out.buffer, base + m.offset, m.length).set(t.cells as ArrayLike<number>);
    if (t.values && m.valuesOffset != null) {
      const v = new DataView(out.buffer, base + m.valuesOffset, t.values.length * 4);
      for (let i = 0; i < t.values.length; i++) { const x = t.values[i]; v.setFloat32(i * 4, x == null ? NaN : x, true); }
    }
  });
  out.set(colBytes, base + columnsOffset);
  return out;
}

export function unpackContract(buf: ArrayBuffer): UnpackedContract {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== MAGIC) throw new Error("not an OPB1 oncoprint payload");
  const headerLen = dv.getUint32(4);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen))) as PackedHeader;
  const base = 8 + pad4(headerLen);
  const tracks = header.tracks.map((m) => {
    const { dtype, offset, length, valuesOffset, ...meta } = m;
    const cells = dtype === "i16" ? new Int16Array(buf, base + offset, length) : new Int32Array(buf, base + offset, length);
    if (valuesOffset == null) return { ...meta, cells };
    // a stacked row holds stack.length values per column
    const nv = length * (meta.stack ? meta.stack.length : 1);
    const dv2 = new DataView(buf, base + valuesOffset, nv * 4), values = new Float32Array(nv);
    for (let i = 0; i < nv; i++) values[i] = dv2.getFloat32(i * 4, true);
    return { ...meta, cells, values };
  });
  let cols: string[] | null = null;
  const columns = () => {
    if (!cols) cols = new TextDecoder().decode(new Uint8Array(buf, base + header.columnsOffset, header.columnsBytes)).split("\n");
    return cols;
  };
  const { tracks: _t, columnsOffset: _o, columnsBytes: _b, format: _f, ...rest } = header;
  return { ...rest, tracks, columns };
}
