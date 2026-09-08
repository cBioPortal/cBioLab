// Hierarchical clustering of oncoprint columns by their molecular values.
//
// Ward linkage on Euclidean distance, by the nearest-neighbour chain algorithm: O(n²) time and
// O(n) memory, because a cluster's Ward distance depends only on centroids and sizes, so no
// pairwise matrix has to be held. Average linkage would need that matrix, which at a few
// thousand columns is hundreds of megabytes.
//
// This runs in the engine rather than the browser so that the SVG, the canvas, the CLI and the
// Python package all draw the same order, and so that the order travels in the contract with
// the numbers it describes.

/** Columns that cannot be clustered honestly: the cost is quadratic and the answer would be a guess. */
export const CLUSTER_LIMIT = Number(process.env.ONCOPRINT_CLUSTER_LIMIT || 4000);

export interface ClusterInput {
  /** column-major values: dims arrays of length n; NaN where a column has no value */
  columns: Float64Array[];
  n: number;
}

/**
 * Leaf order of the Ward dendrogram. Vectors are z-scored per dimension first, so a gene with a
 * wide range does not dominate one with a narrow one, and missing values sit at the mean (they
 * pull a column toward the middle rather than toward an arbitrary end).
 */
export function wardOrder({ columns, n }: ClusterInput): number[] {
  const dims = columns.length;
  if (n <= 2 || dims === 0) return Array.from({ length: n }, (_, i) => i);

  // z-score each dimension, filling gaps with its mean
  const v = new Float64Array(n * dims);
  for (let d = 0; d < dims; d++) {
    const col = columns[d];
    let sum = 0, k = 0;
    for (let i = 0; i < n; i++) if (!Number.isNaN(col[i])) { sum += col[i]; k++; }
    const mean = k ? sum / k : 0;
    let ss = 0;
    for (let i = 0; i < n; i++) if (!Number.isNaN(col[i])) ss += (col[i] - mean) ** 2;
    const sd = k > 1 ? Math.sqrt(ss / (k - 1)) || 1 : 1;
    for (let i = 0; i < n; i++) v[i * dims + d] = Number.isNaN(col[i]) ? 0 : (col[i] - mean) / sd;
  }

  // centroids and sizes; clusters are addressed 0..2n-2, leaves first
  const total = 2 * n - 1;
  const cent = new Float64Array(total * dims);
  cent.set(v.subarray(0, n * dims));
  const size = new Int32Array(total);
  for (let i = 0; i < n; i++) size[i] = 1;
  const left = new Int32Array(total).fill(-1), right = new Int32Array(total).fill(-1);
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i));

  const wardDist = (x: number, y: number): number => {
    let s = 0;
    const xo = x * dims, yo = y * dims;
    for (let d = 0; d < dims; d++) { const t = cent[xo + d] - cent[yo + d]; s += t * t; }
    return (size[x] * size[y]) / (size[x] + size[y]) * s;
  };

  // Nearest-neighbour chain: walk to the nearest neighbour until two clusters are each other's
  // nearest, then merge that pair. Ward is reducible, so the rest of the chain stays valid.
  let next = n;
  const chain: number[] = [];
  while (active.size > 1) {
    if (!chain.length) chain.push(active.values().next().value as number);
    const a = chain[chain.length - 1];
    let best = -1, bestD = Infinity;
    for (const c of active) {
      if (c === a) continue;
      const d = wardDist(a, c);
      if (d < bestD || (d === bestD && c < best)) { bestD = d; best = c; }
    }
    if (best < 0) break;
    if (chain.length >= 2 && best === chain[chain.length - 2]) {
      chain.pop(); chain.pop();
      const m = next++;
      const sa = size[a], sb = size[best], sm = sa + sb;
      for (let d = 0; d < dims; d++) cent[m * dims + d] = (cent[a * dims + d] * sa + cent[best * dims + d] * sb) / sm;
      size[m] = sm;
      left[m] = Math.min(a, best); right[m] = Math.max(a, best);
      active.delete(a); active.delete(best); active.add(m);
    } else chain.push(best);
  }

  // leaf order: depth-first, smaller subtree first so the order is deterministic
  const out: number[] = [];
  const stack = [...active];
  while (stack.length) {
    const node = stack.pop()!;
    if (node < n) { out.push(node); continue; }
    const l = left[node], r = right[node];
    // push the larger first so the smaller comes out first
    if (size[l] <= size[r]) { stack.push(r); stack.push(l); } else { stack.push(l); stack.push(r); }
  }
  return out;
}
