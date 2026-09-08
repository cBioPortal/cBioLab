// Level of detail: how a run of columns collapses into one display code when there are more
// columns than pixels. One implementation for the server SVG and the browser canvas; the
// Python package mirrors it and a conformance test compares bucket codes.
//
//   gene / derived   OR of the altered bitmasks; -1 only when every column is not profiled
//   numeric          mean of the present values (rounded), -1 when none present
//   categorical      the most frequent category; ties go to the lower index; -1 when none
import type { Track } from "./types.ts";

export type TrackShape = Pick<Track, "kind" | "numeric" | "categories">;

/** Column index boundaries for `buckets` buckets over `n` columns; edges[b]..edges[b+1] is bucket b. */
export function bucketEdges(n: number, buckets: number): number[] {
  const nb = Math.max(1, Math.min(n, Math.floor(buckets)));
  const edges = new Array<number>(nb + 1);
  for (let b = 0; b < nb; b++) edges[b] = Math.floor(b * n / nb);
  edges[nb] = n;
  // n > nb guarantees strictly increasing edges; n == nb gives one column per bucket
  return edges;
}

/**
 * Aggregate cells over positions k0..k1 (exclusive). With `order`, position k reads
 * cells[order[k]]; without it, cells[k]. `scratch` must hold at least categories+1 ints.
 */
export function aggregate(t: TrackShape, cells: ArrayLike<number>, order: ArrayLike<number> | null, k0: number, k1: number, scratch: Int32Array): number {
  if (t.numeric) {
    let sum = 0, n = 0;
    for (let k = k0; k < k1; k++) { const c = cells[order ? order[k] : k]; if (c !== -1) { sum += c; n++; } }
    return n ? Math.round(sum / n) : -1;
  }
  if (t.kind === "clinical" && t.categories) {
    const m = t.categories.length + 1; // + Other
    for (let i = 0; i < m; i++) scratch[i] = 0;
    let saw = false;
    for (let k = k0; k < k1; k++) { const c = cells[order ? order[k] : k]; if (c >= 0 && c < m) { scratch[c]++; saw = true; } }
    if (!saw) return -1;
    let best = 0; for (let i = 1; i < m; i++) if (scratch[i] > scratch[best]) best = i;
    return best;
  }
  let code = -1;
  for (let k = k0; k < k1; k++) { const c = cells[order ? order[k] : k]; if (c === -1) continue; code = (code === -1 ? 0 : code) | (c > 0 ? c : 0); }
  return code;
}

/** Every bucket's code for one track over one group, the shape the conformance test compares. */
export function bucketCodes(t: TrackShape, cells: ArrayLike<number>, start: number, count: number, buckets: number): number[] {
  const edges = bucketEdges(count, buckets);
  const scratch = new Int32Array(Math.max(64, (t.categories?.length ?? 0) + 2));
  const out: number[] = [];
  for (let b = 0; b + 1 < edges.length; b++) out.push(aggregate(t, cells, null, start + edges[b], start + edges[b + 1], scratch));
  return out;
}
