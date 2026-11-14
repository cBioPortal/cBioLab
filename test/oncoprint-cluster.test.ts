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

// ---- parity with the portal's own clustering, row by row of the #201 case table --------------------
// The reference is legacy's clustering-worker.ts ported verbatim (scripts/golden/legacy-clustering.cjs) and
// run on legacy's own libraries. Its answers are recorded in test/fixtures/golden/legacy-clustering.json;
// RECORD_LEGACY=1 rewrites that file from ~/cbioportal-frontend (or CBIOPORTAL_FRONTEND).
// Rows C13 (Group by), R3 (track expansions) are not covered here.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { condensedDistances, CLUSTER_EXACT, CLUSTER_SAMPLE, CLUSTER_MAX } from "../lib/oncoprint-cluster.ts";

interface Legacy {
  legacyCluster(cols: (number | null)[][], missing?: "null" | "NaN"): { order: number[]; rows: number[]; nodes: number[][] };
  legacyAverageLinkage(n: number, dist: (a: number, b: number) => number): { order: number[]; nodes: number[][] };
  legacyDistance(a: (number | null)[], b: (number | null)[]): number;
  hasTie(cols: number[][]): boolean;
}
const GOLDEN = "test/fixtures/golden/legacy-clustering.json";
const RECORD = process.env.RECORD_LEGACY === "1";
const keyOf = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "number" && !Number.isFinite(x) ? String(x) : x));
const answers: Record<string, unknown> = RECORD ? {} : JSON.parse(readFileSync(GOLDEN, "utf8")).answers;
const reference: Legacy | null = RECORD ? createRequire(import.meta.url)("../scripts/golden/legacy-clustering.cjs") as Legacy : null;
if (RECORD) process.on("exit", () => writeFileSync(GOLDEN, JSON.stringify({ generatedBy: "scripts/golden/legacy-clustering.cjs", legacy: "cbioportal-frontend cd8c6df clustering-worker.ts, tayden-clusterfck 0.7.0, jstat 1.9.6", answers }) + "\n"));
function answer<T>(key: unknown[], run: () => T): T {
  const k = keyOf(key);
  if (RECORD) return (answers[k] ??= run()) as T;
  if (!(k in answers)) throw new Error(`no recorded legacy answer for ${k.slice(0, 120)}; record with RECORD_LEGACY=1`);
  return answers[k] as T;
}
const legacy: Legacy = {
  legacyCluster: (cols, missing = "null") => answer(["cluster", missing, cols], () => reference!.legacyCluster(cols, missing)),
  legacyAverageLinkage: (n, dist) => {
    const m: number[] = []; for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) m.push(dist(i, j));
    return answer(["averageLinkage", n, m], () => reference!.legacyAverageLinkage(n, dist));
  },
  legacyDistance: (a, b) => answer(["distance", a, b], () => reference!.legacyDistance(a, b)),
  hasTie: (cols) => answer(["hasTie", cols], () => reference!.hasTie(cols)),
};
const L = () => legacy;
/** the portal's leaf order within a merge is not ours (docs/PORTAL-PARITY.md, ONC-STM-9); the tree is */
const orientation = { todo: "leaf order within a merge differs from the portal's (docs/PORTAL-PARITY.md, ONC-STM-9)" };

const ours = (cols: number[][], limits?: { exact?: number; sample?: number; max?: number }) => clusterHeatmap({ rows: rowsOf(cols), n: cols.length }, limits);
/** legacy tree nodes that are not contiguous in an order: empty when the order is a leaf order of legacy's tree */
const splitNodes = (order: number[], nodes: number[][]) => nodes.filter((s) => {
  const p = s.map((i) => order.indexOf(i)).sort((a, b) => a - b);
  return p[p.length - 1] - p[0] !== s.length - 1;
});
/** fractional ranks, ties at their mean */
const fracRanks = (v: number[]) => v.map((x) => { let lo = 0, eq = 0; for (const y of v) { if (y < x) lo++; else if (y === x) eq++; } return lo + (eq + 1) / 2; });
const unit = (v: number[]) => {
  const r = fracRanks(v), m = r.reduce((a, b) => a + b, 0) / r.length, c = r.map((x) => x - m), s = Math.sqrt(c.reduce((a, b) => a + b * b, 0));
  return s ? Float64Array.from(c.map((x) => x / s)) : null;
};
const cAt = (D: Float32Array, i: number, j: number) => (i < j ? D[j * (j - 1) / 2 + i] : D[i * (i - 1) / 2 + j]);
const hasTie = (cols: number[][]) => L().hasTie(cols);
/** random columns: `genes` values each, from `levels` integer levels (ties, duplicates) or continuous when levels is 0 */
const randomCols = (r: () => number, n: number, genes: number, levels: number) =>
  Array.from({ length: n }, () => Array.from({ length: genes }, () => (levels ? Math.floor(r() * levels) - 1 : r() * 4 - 2)));

test("C1 one gene: a sort, ascending, missing last, ties and 0 in place, as legacy", () => {
  const col = [3, NaN, -1, 2, 0, 2, NaN, -0.5, 0];
  const cols = col.map((v) => [v]);
  assert.deepEqual(ours(cols).order, L().legacyCluster(cols).order);
  assert.deepEqual(ours(cols).order, [2, 7, 4, 8, 3, 5, 0, 1, 6], "0 is a value here, not 'no data'");
});

test("C2 columns all missing, null or 0 come after every clustered column, in input order, as legacy", () => {
  const cols = [[0, 0, 0], [1, 2, 3], [NaN, NaN, NaN], [3, 1, 2], [0, NaN, 0], [2, 3, 1], [NaN, 0, NaN], [1, 3, 2]];
  const got = ours(cols), leg = L().legacyCluster(cols);
  assert.deepEqual(got.order.slice(-4), [0, 2, 4, 6]);
  assert.deepEqual(got.order.slice(-4), leg.order.slice(-4));
  assert.equal(got.method.noData, 4);
});

test("C3 tied values take their mean rank: tie-heavy inputs give legacy's tree", () => {
  const r = rnd(101);
  let compared = 0;
  for (let k = 0; k < 400 && compared < 60; k++) {
    const cols = randomCols(r, 5 + Math.floor(r() * 5), 4 + Math.floor(r() * 3), 3);
    if (hasTie(cols)) continue;
    compared++;
    const leg = L().legacyCluster(cols);
    assert.deepEqual(splitNodes(ours(cols).order, leg.nodes), [], JSON.stringify({ cols, ours: ours(cols).order, legacy: leg.order }));
  }
  assert.ok(compared >= 20, `only ${compared} tie-free inputs`);
});

test("C4 a missing value in a column with others: deterministic, clustered (not sent last), each column once", () => {
  const cols = [[-1, NaN, 2], [0, NaN, 2], [1, NaN, 2], [2, 1, 0], [0, 1, 2], [NaN, NaN, 5], [NaN, NaN, NaN]];
  const a = ours(cols), b = ours(cols.map((c) => c.slice()));
  assert.deepEqual(a, b, "same input, same result");
  assert.deepEqual([...a.order].sort((x, y) => x - y), cols.map((_, i) => i));
  assert.equal(a.method.noData, 1, "only the all-missing column is 'no value'");
  assert.equal(a.order[a.order.length - 1], 6);
  assert.ok(a.order.indexOf(5) < a.order.indexOf(6), "a column with one value of three is clustered, ahead of the no-value tail");
});

test("C4 legacy reference: the portal sends a missing value as null, which jStat.rank's comparator orders as 0", () => {
  // jStat.rank sorts distinct values with (a, b) => a - b, and null - x === -x, so null ranks where 0 would
  // (a stable sort puts it beside a real 0 by first appearance). Not in the case table, which calls C4 ill-defined.
  const r = rnd(131);
  let compared = 0;
  for (let k = 0; k < 400 && compared < 40; k++) {
    const cols = randomCols(r, 4 + Math.floor(r() * 5), 5, 0).map((c) => c.map((v) => (r() < 0.2 ? NaN : v)));
    if (cols.some((c) => c.every(Number.isNaN)) || hasTie(cols)) continue;
    compared++;
    const leg = L().legacyCluster(cols, "null");
    assert.deepEqual(splitNodes(ours(cols).order, leg.nodes), [], JSON.stringify({ cols, ours: ours(cols).order, legacy: leg.order }));
  }
  assert.ok(compared >= 20, `only ${compared} tie-free inputs`);
});

test("C5 distance is 1 − Pearson of the fractional ranks, as legacy's preRankedSpearmanDist", () => {
  const r = rnd(5);
  const cols = [...randomCols(r, 6, 5, 3), ...randomCols(r, 6, 5, 0), [1, 2, 2, 4, 4], [4, 4, 2, 2, 1]];
  const D = condensedDistances(cols.map(unit), 5);
  for (let j = 1; j < cols.length; j++) for (let i = 0; i < j; i++)
    assert.ok(Math.abs(cAt(D, i, j) - L().legacyDistance(cols[i], cols[j])) < 1e-6, `${i},${j}: ${cAt(D, i, j)} vs ${L().legacyDistance(cols[i], cols[j])}`);
});

test("C6 columns with all genes equal (gistic −1,−1) are at distance 3 from everything, even each other, as legacy", () => {
  const units = [unit([-1, -1]), unit([-1, -1]), unit([2, 2]), unit([1, 2])];
  assert.deepEqual(units.slice(0, 3), [null, null, null]);
  const D = condensedDistances(units, 2);
  assert.equal(cAt(D, 0, 1), 3, "identical constant columns");
  assert.equal(cAt(D, 0, 2), 3);
  assert.equal(cAt(D, 0, 3), 3);
  assert.equal(L().legacyDistance([-1, -1], [-1, -1]), 3);
  // the gistic shape: most columns constant, a few not
  const cols = [[-1, -1], [1, 2], [-1, -1], [2, 2], [2, 1], [-1, -1], [0, 0], [-2, -1], [1, 1], [2, 1]];
  const got = ours(cols), leg = L().legacyCluster(cols);
  assert.deepEqual(got.order.slice(-1), [6], "the all-0 column is 'no value'");
  assert.deepEqual(got.order.slice(-1), leg.order.slice(-1));
});

test("C6 the constant columns: exact order as legacy", orientation, () => {
  const cols = [[-1, -1], [1, 2], [-1, -1], [2, 2], [2, 1], [-1, -1], [0, 0], [-2, -1], [1, 1], [2, 1]];
  assert.deepEqual(ours(cols).order, L().legacyCluster(cols).order);
});

test("C6 the constant columns: same tree as legacy (leaf flips aside)", () => {
  const cols = [[-1, -1], [1, 2], [-1, -1], [2, 2], [2, 1], [-1, -1], [0, 0], [-2, -1], [1, 1], [2, 1]];
  assert.deepEqual(splitNodes(ours(cols).order, L().legacyCluster(cols).nodes), []);
});

test("C7 average linkage on a distance matrix: legacy hcluster's tree", () => {
  const r = rnd(17);
  for (let k = 0; k < 40; k++) {
    const n = 4 + Math.floor(r() * 8), m = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
    for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) m[i][j] = m[j][i] = Math.round(r() * 1e6) / 1e6 + 1e-3;
    const D = new Float32Array(n * (n - 1) / 2); for (let j = 1, o = 0; j < n; j++) for (let i = 0; i < j; i++, o++) D[o] = m[i][j];
    const leg = L().legacyAverageLinkage(n, (a, b) => m[a][b]);
    assert.deepEqual(splitNodes(averageLinkageOrder(n, D, () => 1), leg.nodes), [], JSON.stringify({ m, legacy: leg.order }));
  }
});

test("C7 average, not single or complete: a case where the three disagree", () => {
  // 0-1 close; 2 is nearer 0 than 1 (single would join 2 next), 3 sits between
  const m = [[0, 1, 4, 6], [1, 0, 9, 6.2], [4, 9, 0, 6.4], [6, 6.2, 6.4, 0]];
  const D = Float32Array.from([1, 4, 9, 6, 6.2, 6.4]);
  const leg = L().legacyAverageLinkage(4, (a, b) => m[a][b]);
  assert.deepEqual(splitNodes(averageLinkageOrder(4, D, () => 1), leg.nodes), []);
});

test("C8 duplicate columns weigh as many: a weighted point is n copies of itself in legacy", () => {
  const r = rnd(29);
  for (let k = 0; k < 40; k++) {
    const n = 3 + Math.floor(r() * 6), w = Array.from({ length: n }, () => 1 + Math.floor(r() * 4));
    const m = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
    for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) m[i][j] = m[j][i] = Math.round(r() * 1e6) / 1e6 + 1e-3;
    const D = new Float32Array(n * (n - 1) / 2); for (let j = 1, o = 0; j < n; j++) for (let i = 0; i < j; i++, o++) D[o] = m[i][j];
    const of = w.flatMap((c, i) => Array.from({ length: c }, () => i)); // copy -> point
    const leg = L().legacyAverageLinkage(of.length, (a, b) => (of[a] === of[b] ? 0 : m[of[a]][of[b]]));
    // legacy's tree over points: its nodes that hold whole copy-sets, as point sets
    const nodes = leg.nodes.map((s) => [...new Set(s.map((i) => of[i]))].sort((a, b) => a - b))
      .filter((s) => s.length > 1);
    const got = averageLinkageOrder(n, D, (i) => w[i]);
    assert.deepEqual(splitNodes(got, nodes), [], JSON.stringify({ w, m, ours: got, legacy: leg.order.map((i) => of[i]) }));
  }
});

test("C8 duplicate columns end to end: ours over patterns gives legacy's tree over every column", () => {
  const r = rnd(43);
  let compared = 0;
  for (let k = 0; k < 400 && compared < 40; k++) {
    const base = randomCols(r, 3 + Math.floor(r() * 4), 5, 0);
    const cols = Array.from({ length: base.length + 2 + Math.floor(r() * 6) }, (_, i) => base[i < base.length ? i : Math.floor(r() * base.length)].slice());
    if (hasTie(cols)) continue;
    compared++;
    const leg = L().legacyCluster(cols), got = ours(cols);
    // legacy's nodes, coarsened to patterns: a node that splits a set of identical columns is legacy's float noise
    const key = (i: number) => cols[i].join();
    const nodes = leg.nodes.filter((s) => cols.every((_, i) => !s.some((j) => key(j) === key(i)) || s.includes(i)));
    assert.deepEqual(splitNodes(got.order, nodes), [], JSON.stringify({ cols, ours: got.order, legacy: leg.order }));
    for (const s of new Set(cols.map((_, i) => key(i)))) {
      const p = got.order.map((c, i) => [key(c), i] as const).filter(([kk]) => kk === s).map(([, i]) => i);
      assert.equal(p[p.length - 1] - p[0], p.length - 1, "identical columns side by side");
    }
  }
  assert.ok(compared >= 20, `only ${compared} tie-free inputs`);
});

test("C9 equal distances: legacy merges the earliest cluster with its nearest; ours, exact order", orientation, () => {
  // four points all at distance 1: every merge is a tie
  const eq = (n: number) => { const D = new Float32Array(n * (n - 1) / 2).fill(1); return D; };
  for (const n of [3, 4, 5]) {
    const leg = L().legacyAverageLinkage(n, () => 1);
    assert.deepEqual(averageLinkageOrder(n, eq(n), () => 1), leg.order, `n=${n}: legacy ${JSON.stringify(leg.order)} tree ${JSON.stringify(leg.nodes)}`);
  }
});

test("C9 equal distances: same tree as legacy (flips aside)", () => {
  for (const n of [3, 4, 5]) {
    const leg = L().legacyAverageLinkage(n, () => 1);
    assert.deepEqual(splitNodes(averageLinkageOrder(n, new Float32Array(n * (n - 1) / 2).fill(1), () => 1), leg.nodes), [], `n=${n}: legacy tree ${JSON.stringify(leg.nodes)}`);
  }
});

test("C10 leaf order: legacy lists the merging cluster (c1) before its nearest (c2); exact order on two and three columns", orientation, () => {
  for (const cols of [[[1, 2], [2, 1]], [[1, 2, 3], [1, 2, 3.5], [3, 2, 1]], [[1, 2, 3], [3, 2, 1], [1, 2, 3.5]]]) {
    assert.deepEqual(ours(cols).order, L().legacyCluster(cols).order, JSON.stringify(cols));
  }
});

test("C10 leaf order: tie-free random inputs, exact order as legacy", orientation, () => {
  const r = rnd(61);
  const bad: string[] = [];
  let compared = 0;
  for (let k = 0; k < 300 && compared < 40; k++) {
    const cols = randomCols(r, 4 + Math.floor(r() * 5), 6, 0);
    if (hasTie(cols)) continue;
    compared++;
    const got = ours(cols).order, leg = L().legacyCluster(cols);
    if (got.join() !== leg.order.join()) bad.push(`ours ${got.join()} legacy ${leg.order.join()}${splitNodes(got, leg.nodes).length ? " (different tree)" : " (same tree, flipped)"}`);
  }
  assert.deepEqual(bad, []);
});

test("C5/C7 tie-free random inputs: same tree as legacy", () => {
  const r = rnd(61);
  let compared = 0;
  for (let k = 0; k < 300 && compared < 40; k++) {
    const cols = randomCols(r, 4 + Math.floor(r() * 5), 6, 0);
    if (hasTie(cols)) continue;
    compared++;
    const leg = L().legacyCluster(cols);
    assert.deepEqual(splitNodes(ours(cols).order, leg.nodes), [], JSON.stringify({ cols, ours: ours(cols).order, legacy: leg.order }));
  }
});

test("R1 rows: clustered by the same method over genes, exact order as legacy (2 and 3+ genes)", orientation, () => {
  const r = rnd(71);
  const cases = [
    [[1, 2], [2, 4], [3, 1], [4, 3]],                       // 2 genes
    ...Array.from({ length: 10 }, () => randomCols(r, 7, 3 + Math.floor(r() * 4), 0))
  ];
  const bad = cases.map((cols) => [ours(cols).rows, L().legacyCluster(cols).rows]).filter(([a, b]) => a.join() !== b.join());
  assert.deepEqual(bad, []);
});

test("R1 rows: same tree over genes as legacy (flips aside), 3+ genes, tie-free", () => {
  const r = rnd(73);
  for (let k = 0; k < 20; k++) {
    const cols = randomCols(r, 7, 3 + Math.floor(r() * 4), 0), genes = cols[0].map((_, g) => cols.map((c) => c[g]));
    if (hasTie(genes)) continue;
    const leg = L().legacyAverageLinkage(genes.length, (a, b) => L().legacyDistance(genes[a], genes[b]));
    assert.deepEqual(splitNodes(ours(cols).rows, leg.nodes), [], JSON.stringify({ cols, ours: ours(cols).rows, legacy: leg.order }));
  }
});

test("R2 a gene whose values are all missing or 0 is last, as legacy", () => {
  const cols = [[0, 1, NaN, 3, 2], [0, 2, NaN, 1, 3], [0, 3, NaN, 2, 1], [0, 4, NaN, 5, 6]];
  const got = ours(cols).rows, leg = L().legacyCluster(cols).rows;
  assert.deepEqual(got.slice(-2), [0, 2]);
  assert.deepEqual(got.slice(-2), leg.slice(-2));
});

/** n columns with distinct rank patterns (permutations of 1..genes) */
const distinctPatterns = (n: number, genes: number) => {
  const r = rnd(97), seen = new Set<string>(), out: number[][] = [];
  while (out.length < n) {
    const p = Array.from({ length: genes }, (_, i) => i + 1);
    for (let i = genes - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    if (!seen.has(p.join())) { seen.add(p.join()); out.push(p); }
  }
  return out;
};

test("X1 up to the exact limit of distinct patterns, exact, however many columns", () => {
  const base = distinctPatterns(10, 5);
  const cols = Array.from({ length: 200 }, (_, i) => base[i % 10].map((v) => v * (1 + (i % 7))));
  const res = ours(cols, { exact: 10, sample: 5, max: 20 });
  assert.equal(res.method.patterns, 10);
  assert.equal(res.method.approximate, undefined);
  assert.equal(CLUSTER_EXACT, 8000);
});

test("X2 past the exact limit: a sample of CLUSTER_SAMPLE patterns, said to be approximate, each column once, repeatable", () => {
  const cols = distinctPatterns(60, 6);
  const res = ours(cols, { exact: 40, sample: 25, max: 100 });
  assert.deepEqual(res.method.approximate, { sampled: 25 });
  assert.equal(res.method.patterns, 60);
  assert.deepEqual([...res.order].sort((a, b) => a - b), cols.map((_, i) => i));
  assert.deepEqual(ours(cols, { exact: 40, sample: 25, max: 100 }).order, res.order);
  assert.equal(CLUSTER_SAMPLE, 2000);
  assert.equal(ours(cols, { exact: 60 }).method.approximate, undefined, "at exactly the limit, exact");
});

test("X3 past the maximum of distinct patterns: refused, naming the limit", () => {
  const cols = distinctPatterns(31, 6);
  assert.throws(() => ours(cols, { max: 30 }), /30/);
  assert.doesNotThrow(() => ours(cols, { max: 31 }), "at exactly the maximum, clustered");
  assert.equal(CLUSTER_MAX, 50000);
});

test("X4 the method record counts what was done: columns, no-value columns, patterns", () => {
  const cols = [[1, 2, 3], [1, 2, 3], [3, 2, 1], [NaN, NaN, NaN], [0, 0, 0], [2, 4, 6]];
  assert.deepEqual(ours(cols).method, { columns: 6, noData: 2, patterns: 2 });
});
