// Hierarchical clustering of an oncoprint heatmap group, as the portal clusters one
// (oncoprintjs clustering-worker: tayden-clusterfck, ONC-STM-9): average linkage on the distance
// 1 − Spearman ρ, over the group's cases (columns) and over its rows.
//
// The portal's own library holds every pairwise distance and fails past about 8–10k columns
// (docs/spikes/oncoprint-clustering.md). Two cases with the same rank pattern are at distance 0
// from each other and at the same distance from every other case, so clustering the distinct
// patterns, each weighted by how many cases share it, gives the same tree. Real cohorts have
// far fewer patterns than columns (msk_chord_2024's CNA: 25,040 columns, 602 patterns).
// Past CLUSTER_EXACT patterns a sample of CLUSTER_SAMPLE is clustered and every other pattern
// placed beside its nearest sampled one; the result says it is approximate. Past CLUSTER_MAX
// the engine refuses.
//
// This runs in the engine rather than the browser so that the SVG, the canvas, the CLI and the
// Python package all draw the same order, and the order travels in the contract with the
// numbers it describes.

/** distinct patterns clustered exactly */
export const CLUSTER_EXACT = Number(process.env.ONCOPRINT_CLUSTER_EXACT || 8000);
/** patterns clustered when there are more than CLUSTER_EXACT; the rest join their nearest */
export const CLUSTER_SAMPLE = 2000;
/** distinct patterns past which clustering is refused */
export const CLUSTER_MAX = 50000;

export interface ClusterInput {
  /** row-major by track: one array of length n per row (a gene of the profile); NaN where a case has no value */
  rows: Float64Array[];
  n: number;
}

export interface ClusterResult {
  /** the columns' order: clustered, then those with no value but 0 or none, as the portal places them */
  order: number[];
  /** the rows' order (identity for fewer than three rows) */
  rows: number[];
  /** what was done, for the caption and the method record */
  method: { columns: number; noData: number; patterns: number; approximate?: { sampled: number } };
}

/** fractional ranks (ties share their mean rank), as jStat.rank gives them */
function ranks(v: ArrayLike<number>): Float64Array {
  const n = v.length, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  const r = new Float64Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && v[idx[j + 1]] === v[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** ranks centred and scaled to unit length, so ρ is a dot product; null when they are constant (ρ undefined) */
function unitRanks(v: ArrayLike<number>): Float64Array | null {
  const r = ranks(v), m = r.length;
  let mean = 0; for (let i = 0; i < m; i++) mean += r[i]; mean /= m;
  let ss = 0; for (let i = 0; i < m; i++) { r[i] -= mean; ss += r[i] * r[i]; }
  if (!(ss > 0)) return null;
  const s = Math.sqrt(ss); for (let i = 0; i < m; i++) r[i] /= s;
  return r;
}

/** the condensed matrix of 1 − ρ between unit rank vectors (3 where either is constant), pair (i, j) with i < j at j(j−1)/2 + i */
export function condensedDistances(units: (Float64Array | null)[], dims: number): Float32Array {
  const n = units.length, U = new Float64Array(n * dims), constant = new Uint8Array(n);
  units.forEach((u, i) => { if (u) U.set(u, i * dims); else constant[i] = 1; });
  const D = new Float32Array(n * (n - 1) / 2);
  for (let j = 1, o = 0; j < n; j++) for (let i = 0; i < j; i++, o++) {
    if (constant[i] || constant[j]) { D[o] = 3; continue; }
    let dot = 0; const a = i * dims, b = j * dims;
    for (let d = 0; d < dims; d++) dot += U[a + d] * U[b + d];
    D[o] = 1 - dot;
  }
  return D;
}

/**
 * Average-linkage leaf order of n weighted points, from their condensed distance matrix (which it
 * overwrites), by the nearest-neighbour chain (exact for average linkage, which is reducible). A
 * merged cluster lists first the child holding the earlier point, so the order is deterministic.
 */
export function averageLinkageOrder(n: number, D: Float32Array, weight: (i: number) => number): number[] {
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const row = Float64Array.from({ length: n }, (_, j) => j * (j - 1) / 2);   // start of row j in D
  const at = (i: number, j: number) => i < j ? row[j] + i : row[i] + j;
  const size = Float64Array.from({ length: n }, (_, i) => weight(i));
  const active = new Uint8Array(n).fill(1);
  // each cluster's leaves as a linked list: head, tail, next
  const head = Int32Array.from({ length: n }, (_, i) => i), tail = Int32Array.from({ length: n }, (_, i) => i), next = new Int32Array(n).fill(-1);
  const first = Int32Array.from({ length: n }, (_, i) => i);
  const chain: number[] = [];
  let left = n;
  while (left > 1) {
    if (!chain.length) { let s = 0; while (!active[s]) s++; chain.push(s); }
    const a = chain[chain.length - 1], prev = chain.length > 1 ? chain[chain.length - 2] : -1;
    let b = prev, best = prev >= 0 ? D[at(a, prev)] : Infinity;
    // row a: (k, a) for k < a, then (a, k) for k > a
    const ra = row[a];
    for (let k = 0; k < a; k++) if (active[k]) { const d = D[ra + k]; if (d < best) { best = d; b = k; } }
    for (let k = a + 1; k < n; k++) if (active[k]) { const d = D[row[k] + a]; if (d < best) { best = d; b = k; } }
    if (b !== prev) { chain.push(b); continue; }
    chain.pop(); chain.pop();
    // merge b into a (a keeps the slot), the distances by the size-weighted mean
    const sa = size[a], sb = size[b], st = sa + sb;
    for (let k = 0; k < n; k++) if (active[k] && k !== a && k !== b) { const ia = at(a, k); D[ia] = (sa * D[ia] + sb * D[at(b, k)]) / st; }
    const [x, y] = first[a] <= first[b] ? [a, b] : [b, a];
    next[tail[x]] = head[y];
    head[a] = head[x]; tail[a] = tail[y]; first[a] = Math.min(first[a], first[b]);
    size[a] = st; active[b] = 0; left--;
  }
  let root = 0; while (!active[root]) root++;
  const out: number[] = [];
  for (let k = head[root]; k !== -1; k = next[k]) out.push(k);
  return out;
}

/** a small deterministic generator (mulberry32), so a sampled clustering repeats exactly */
function seeded(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** The portal's clustering of a heatmap group: its columns' order and its rows'. */
export function clusterHeatmap({ rows, n }: ClusterInput, limits: { exact?: number; sample?: number; max?: number } = {}): ClusterResult {
  const EXACT = limits.exact ?? CLUSTER_EXACT, SAMPLE = limits.sample ?? CLUSTER_SAMPLE, MAX = limits.max ?? CLUSTER_MAX;
  const dims = rows.length;
  // the portal ranks a missing value as 0, tied with real zeros
  const val = (d: number, i: number) => { const x = rows[d][i]; return Number.isNaN(x) ? 0 : x; };
  const noData: number[] = [], cases: number[] = [];
  for (let i = 0; i < n; i++) {
    let any = false; for (let d = 0; d < dims; d++) if (val(d, i) !== 0) { any = true; break; }
    (any ? cases : noData).push(i);
  }

  let order: number[], approximate: { sampled: number } | undefined;
  if (dims === 1) {
    // one row: a plain ascending sort, no value last (the portal's one-track group)
    const r = rows[0];
    order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const x = r[a], y = r[b], na = Number.isNaN(x), nb = Number.isNaN(y);
      return na || nb ? (na === nb ? a - b : na ? 1 : -1) : x - y || a - b;
    });
    return { order, rows: [0], method: { columns: n, noData: order.filter((i) => Number.isNaN(r[i])).length, patterns: n } };
  }
  // distinct rank patterns, each weighted by its cases; a constant column (ρ undefined) stays alone
  const key = new Map<string, number>(), pat: { unit: Float64Array | null; cases: number[] }[] = [];
  for (const i of cases) {
    const v = new Float64Array(dims); for (let d = 0; d < dims; d++) v[d] = val(d, i);
    const r = ranks(v), u = unitRanks(v);
    const k = u ? Array.from(r).join(",") : "#" + i;
    const p = key.get(k);
    if (p === undefined) { key.set(k, pat.length); pat.push({ unit: u, cases: [i] }); } else pat[p].cases.push(i);
  }
  const patterns = pat.length;
  if (patterns > MAX)
    throw new Error("clustering: " + patterns.toLocaleString() + " distinct patterns among " + cases.length.toLocaleString() +
      " columns; the limit is " + MAX.toLocaleString() + ". Narrow the cohort, or sort by one of the profile's tracks instead.");
  let patOrder: number[];
  if (patterns <= EXACT) {
    patOrder = averageLinkageOrder(patterns, condensedDistances(pat.map((p) => p.unit), dims), (a) => pat[a].cases.length);
  } else {
    // a seeded sample clustered exactly; every other pattern joins its nearest sampled one
    const rnd = seeded(patterns), idx = Array.from({ length: patterns }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const sample = idx.slice(0, SAMPLE).sort((a, b) => a - b);
    const joined = new Map<number, number[]>(sample.map((s) => [s, []]));
    const inSample = new Set(sample);
    // the sample's unit rank vectors side by side, so the nearest is a tight dot-product loop
    // (a constant pattern is at distance 3 from every other, so it joins the first sampled one)
    const S = new Float64Array(sample.length * dims), constant = new Uint8Array(sample.length);
    sample.forEach((sp, k) => { const u = pat[sp].unit; if (u) S.set(u, k * dims); else constant[k] = 1; });
    for (let p = 0; p < patterns; p++) {
      if (inSample.has(p)) continue;
      const u = pat[p].unit;
      let best = 0, bd = Infinity;
      if (u) for (let k = 0; k < sample.length; k++) {
        if (constant[k]) continue;
        let dot = 0; const o = k * dims;
        for (let d = 0; d < dims; d++) dot += u[d] * S[o + d];
        const dd = 1 - dot;
        if (dd < bd) { bd = dd; best = k; }
      }
      if (bd >= 3) best = 0;
      joined.get(sample[best])!.push(p);
    }
    const sOrder = averageLinkageOrder(sample.length, condensedDistances(sample.map((sp) => pat[sp].unit), dims),
      (a) => pat[sample[a]].cases.length + joined.get(sample[a])!.reduce((m, p) => m + pat[p].cases.length, 0));
    patOrder = sOrder.flatMap((a) => [sample[a], ...joined.get(sample[a])!]);
    approximate = { sampled: SAMPLE };
  }
  order = [...patOrder.flatMap((p) => pat[p].cases), ...noData];

  // the rows, by the same distance over every case; a row with no value but 0 goes last, as the
  // portal's (clustering-worker hclusterGeneticEntities: its all-NaN items follow the clustered ones)
  const rowHas = rows.map((_, d) => { for (let i = 0; i < n; i++) if (val(d, i) !== 0) return true; return false; });
  const live = rows.map((_, d) => d).filter((d) => rowHas[d]), empty = rows.map((_, d) => d).filter((d) => !rowHas[d]);
  const rowUnits = live.map((d) => { const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = val(d, i); return unitRanks(v); });
  const rowOrder = [...(live.length < 3 ? live : averageLinkageOrder(live.length, condensedDistances(rowUnits, n), () => 1).map((k) => live[k])), ...empty];

  return { order, rows: rowOrder, method: { columns: n, noData: noData.length, patterns, ...(approximate ? { approximate } : {}) } };
}
