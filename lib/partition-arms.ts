// Building and editing a partition's arms — pure and browser-safe, shared by the server's "split
// by" proposal, Explore's "split by this", the analysis page's partition panel and the
// assistant's tools, so every path picks arms by the same rule.
import type { Clause, Leaf, PartitionArm, PartitionDef } from "./types.ts";

export const SPLIT_BY_DEFAULT_MAX_ARMS = 8;
export const SPLIT_BY_DEFAULT_MIN_COUNT = 10;

export interface ValueCount { v: string; n: number }

/**
 * Which values of a categorical attribute get an arm of their own: the most frequent first (ties
 * alphabetical, so the same data always gives the same arms), at most maxArms-1 of them so the
 * remainder still has room, and only values held by at least minCount patients. Everything not
 * chosen goes to the remainder, which says so by listing them.
 */
export function chooseArmValues(values: ValueCount[], maxArms = SPLIT_BY_DEFAULT_MAX_ARMS, minCount = SPLIT_BY_DEFAULT_MIN_COUNT):
  { own: ValueCount[]; pooled: ValueCount[] } {
  const sorted = values.filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (a.v < b.v ? -1 : 1));
  const eligible = sorted.filter((x) => x.n >= minCount);
  const own = eligible.slice(0, maxArms - 1);
  return { own, pooled: sorted.filter((x) => !own.includes(x)) };
}

/** A partition of `of` with one arm per chosen value of a categorical attribute. */
export function partitionFromValues(of: string, attribute: string, per: "patient" | "sample", values: ValueCount[],
  opts: { maxArms?: number; minCount?: number } = {}): { def: PartitionDef; pooled: string[] } {
  const minCount = opts.minCount ?? SPLIT_BY_DEFAULT_MIN_COUNT;
  const { own, pooled } = chooseArmValues(values, opts.maxArms, minCount);
  if (own.length < 1)
    throw new Error("no value of " + attribute + " is held by at least " + minCount + " patients in “" + of + "” — nothing to split on");
  const arms: PartitionArm[] = own.map((x) => ({
    name: armLabel(x.v),
    where: { kind: "clinical", attribute, ...(per === "sample" ? { per } : {}), values: [x.v] }
  }));
  return {
    def: { of, arms, source: { attribute, minCount, ...(pooled.length ? { otherValues: pooled.slice(0, 50).map((x) => x.v) } : {}) } },
    pooled: pooled.map((x) => x.v)
  };
}

/** A gene's mutated / wild-type split (not-profiled patients get their own child from the engine). */
export function partitionFromGene(of: string, gene: string): PartitionDef {
  const g = gene.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)) throw new Error("'" + gene + "' is not a valid gene symbol");
  return { of, arms: [{ name: g + " mutated", where: { kind: "oql", q: g + ": MUT" } }], other: g + " wild-type", source: { gene: g } };
}

/** One arm per OQL query, first match wins. */
export function partitionFromOql(of: string, queries: string[]): PartitionDef {
  const qs = queries.map((q) => q.trim()).filter(Boolean);
  if (!qs.length) throw new Error("give at least one OQL query");
  return { of, arms: qs.map((q) => ({ name: armLabel(q), where: { kind: "oql", q } })), source: { oql: qs } };
}

export function armLabel(v: string): string {
  const s = String(v).trim() || "(blank)";
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}

/** `base`, or `base 2`, `base 3`, … — the first not already taken. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let i = 2; ; i++) if (!t.has(base + " " + i)) return base + " " + i;
}

export function moveArm(def: PartitionDef, from: number, to: number): PartitionDef {
  if (to < 0 || to >= def.arms.length) return def;
  const arms = [...def.arms];
  const [a] = arms.splice(from, 1);
  arms.splice(to, 0, a);
  return { ...def, arms };
}

export function removeArm(def: PartitionDef, i: number): PartitionDef {
  return { ...def, arms: def.arms.filter((_, k) => k !== i) };
}

function leavesOf(c: Clause): Leaf[] | null {
  if ((c as { not?: unknown }).not) return null;
  const any = (c as { any?: Leaf[] }).any;
  return Array.isArray(any) ? any : [c as Leaf];
}

/** Whether two arms can be merged into one "either" arm: neither may be a negation. */
export function canMergeArms(def: PartitionDef, i: number, j: number): boolean {
  const a = def.arms[i], b = def.arms[j];
  if (!a || !b || i === j) return false;
  const la = leavesOf(a.where), lb = leavesOf(b.where);
  return !!la && !!lb && la.length + lb.length <= 8;
}

/** Merge arm j into arm i: one arm matching either, at arm i's position. */
export function mergeArms(def: PartitionDef, i: number, j: number): PartitionDef {
  if (!canMergeArms(def, i, j)) throw new Error("these two arms cannot be merged (a negated arm, or more than 8 conditions)");
  const a = def.arms[i], b = def.arms[j];
  const leaves = [...leavesOf(a.where)!, ...leavesOf(b.where)!];
  // two values of one clinical attribute stay one leaf, as a facet's multi-value pick does
  const clin = leaves.every((l) => (l as { kind?: string }).kind === "clinical" && Array.isArray((l as { values?: unknown[] }).values)
    && (l as { attribute: string }).attribute === (leaves[0] as { attribute: string }).attribute
    && ((l as { per?: string }).per || "patient") === ((leaves[0] as { per?: string }).per || "patient"));
  const where: Clause = clin
    ? { ...(leaves[0] as Leaf & object), values: leaves.flatMap((l) => (l as { values: (string | number)[] }).values) } as Leaf
    : leaves.length === 1 ? leaves[0] : { any: leaves };
  const merged: PartitionArm = { name: armLabel(a.name + " + " + b.name), where };
  const arms = def.arms.map((x, k) => k === i ? merged : x).filter((_, k) => k !== j);
  return { ...def, arms };
}

/** Every partition that, directly or through another partition, splits a child of `name`. */
export function descendantPartitions(partitions: Record<string, PartitionDef>, name: string): string[] {
  const out: string[] = [];
  const walk = (n: string) => {
    for (const [k, p] of Object.entries(partitions)) {
      if (!out.includes(k) && p.of.startsWith(n + " / ")) { out.push(k); walk(k); }
    }
  };
  walk(name);
  return out;
}

/**
 * Remove a partition and every partition nested under one of its children. A view that named the
 * partition shows the cohort it split instead; references to any removed child are dropped, and a
 * view left with no cohorts goes, as when a cohort is removed.
 */
export function withoutPartition<D extends { partitions?: Record<string, PartitionDef>; views?: unknown[] }>(doc: D, name: string):
  { doc: D; removed: string[] } {
  const parts = { ...(doc.partitions || {}) };
  if (!parts[name]) throw new Error("no partition “" + name + "”; have " + (Object.keys(parts).join(", ") || "none"));
  const removed = [name, ...descendantPartitions(parts, name)];
  for (const n of removed) delete parts[n];
  const gone = (c: string) => removed.some((n) => c === n || c.startsWith(n + " / "));
  const of = doc.partitions![name].of;
  const views = (doc.views || [])
    .map((v) => {
      const cs = (v as { cohorts?: string[] }).cohorts;
      if (!Array.isArray(cs)) return v;
      const next = cs.flatMap((c) => c === name && !gone(of) ? [of] : gone(c) ? [] : [c]);
      return { ...(v as object), cohorts: next.filter((c, i) => next.indexOf(c) === i) };
    })
    .filter((v) => { const cs = (v as { cohorts?: string[] }).cohorts; return !Array.isArray(cs) || cs.length; });
  const next = { ...doc, views } as D;
  if (Object.keys(parts).length) next.partitions = parts; else delete next.partitions;
  return { doc: next, removed };
}
