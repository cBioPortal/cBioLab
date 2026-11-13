// The portal's clustering of a heatmap group (ONC-STM-9): average linkage on 1 − Spearman,
// over distinct rank patterns, with the cases that have no value placed last.
import test from "node:test";
import assert from "node:assert/strict";
import { clusterHeatmap, averageLinkageOrder } from "../lib/oncoprint-cluster.ts";

/** rows (one per gene) from per-column vectors */
const rowsOf = (cols: number[][]) => cols[0].map((_, d) => Float64Array.from(cols.map((c) => c[d])));

/** a textbook average linkage over every column, O(n³): the reference the pattern clustering must equal */
function naive(cols: number[][]): number[] {
  const rank = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return v.map((x) => { const f = s.indexOf(x), l = s.lastIndexOf(x); return (f + l) / 2 + 1; }); };
  const rho = (a: number[], b: number[]) => {
    const ra = rank(a), rb = rank(b), m = ra.length, ma = ra.reduce((x, y) => x + y, 0) / m, mb = rb.reduce((x, y) => x + y, 0) / m;
    let num = 0, da = 0, db = 0; for (let i = 0; i < m; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : NaN;
  };
  const d = (a: number[], b: number[]) => { const r = rho(a, b); return Number.isNaN(r) ? 3 : 1 - r; };
  let clusters = cols.map((_, i) => [i]);
  const cd = (x: number[], y: number[]) => { let s = 0; for (const i of x) for (const j of y) s += d(cols[i], cols[j]); return s / (x.length * y.length); };
  while (clusters.length > 1) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const v = cd(clusters[i], clusters[j]); if (v < best - 1e-12) { best = v; bi = i; bj = j; } }
    const [x, y] = clusters[bi][0] <= clusters[bj][0] ? [clusters[bi], clusters[bj]] : [clusters[bj], clusters[bi]];
    const merged = [...x, ...y];
    clusters = clusters.filter((_, k) => k !== bi && k !== bj); clusters.push(merged); clusters.sort((a, b) => Math.min(...a) - Math.min(...b));
  }
  return clusters[0];
}

const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test("clustering distinct patterns, weighted, gives the tree of clustering every column", () => {
  const r = rnd(7), base = Array.from({ length: 12 }, () => Array.from({ length: 5 }, () => r() * 6 - 3));
  // 36 columns, three copies of each of 12 patterns, shuffled in
  const cols = Array.from({ length: 36 }, (_, i) => base[(i * 5) % 12].slice());
  const got = clusterHeatmap({ rows: rowsOf(cols), n: cols.length });
  assert.ok(got.method.patterns <= 12 && got.method.patterns > 1);
  assert.deepEqual(got.order, naive(cols));
});

test("like columns end up together, cases with no value last, a constant case apart (distance 3)", () => {
  const up = [1, 2, 3, 4], down = [4, 3, 2, 1];
  const cols = [up, down, [0, 0, 0, 0], up.map((x) => x * 2), [5, 5, 5, 5], down.map((x) => x + 1), [NaN, NaN, NaN, NaN]];
  const { order, method } = clusterHeatmap({ rows: rowsOf(cols), n: cols.length });
  assert.deepEqual(order.slice(-2), [2, 6], "all-0 and all-missing columns last, in their order");
  const pos = (i: number) => order.indexOf(i);
  assert.equal(Math.abs(pos(0) - pos(3)), 1, "the two rising columns together");
  assert.equal(Math.abs(pos(1) - pos(5)), 1, "the two falling columns together");
  assert.deepEqual([method.columns, method.noData, method.patterns], [7, 2, 3]);
});

test("one row: an ascending sort, no value last, as the portal does for a one-track group", () => {
  const { order } = clusterHeatmap({ rows: [Float64Array.from([3, NaN, -1, 2])], n: 4 });
  assert.deepEqual(order, [2, 3, 0, 1]);
});

test("the rows cluster too: correlated genes side by side", () => {
  const n = 20, r = rnd(3);
  const a = Array.from({ length: n }, () => r()), b = a.map((x) => x + 0.01 * r()), c = a.map((x) => -x);
  const { rows } = clusterHeatmap({ rows: [a, c, b].map((x) => Float64Array.from(x)), n });
  assert.equal(Math.abs(rows.indexOf(0) - rows.indexOf(2)), 1, "the two alike rows adjacent");
});

test("past the exact limit a sample is clustered and the rest placed by their nearest, said to be approximate; past the maximum, refused", () => {
  const r = rnd(11), cols = Array.from({ length: 300 }, () => Array.from({ length: 8 }, () => r()));
  const res = clusterHeatmap({ rows: rowsOf(cols), n: cols.length }, { exact: 100, sample: 50 });
  assert.deepEqual(res.method.approximate, { sampled: 50 });
  assert.deepEqual([...res.order].sort((x, y) => x - y), cols.map((_, i) => i), "every column placed once");
  assert.deepEqual(clusterHeatmap({ rows: rowsOf(cols), n: cols.length }, { exact: 100, sample: 50 }).order, res.order, "deterministic");
  assert.throws(() => clusterHeatmap({ rows: rowsOf(cols), n: cols.length }, { max: 100 }), /distinct patterns .* the limit is 100/);
});

test("average linkage leaf order on a tiny case", () => {
  // 0 and 2 are close, 1 and 3 are close
  const p = [0, 10, 0.1, 10.2];
  const D = new Float32Array(6); for (let j = 1, o = 0; j < 4; j++) for (let i = 0; i < j; i++, o++) D[o] = Math.abs(p[i] - p[j]);
  assert.deepEqual(averageLinkageOrder(4, D, () => 1), [0, 2, 1, 3]);
});
