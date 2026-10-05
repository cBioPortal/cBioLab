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

/** "gt 10, lte 20" as a short label: "> 10 – ≤ 20" */
function rangeLabel(r: { gt?: number; gte?: number; lt?: number; lte?: number }): string {
  const lo = r.gt != null ? "> " + r.gt : r.gte != null ? "≥ " + r.gte : "";
  const hi = r.lt != null ? "< " + r.lt : r.lte != null ? "≤ " + r.lte : "";
  return lo && hi ? lo + " and " + hi : lo || hi || "any";
}

export type ChartKey =
  | { kind: "clinical"; attribute: string; per?: "patient" | "sample" }
  /** a gene table: the OQL entries of one alteration kind (": MUT", ": AMP"/": HOMDEL", ": FUSION") */
  | { kind: "genes"; specs: string[] };

/**
 * Explore's selection in ONE chart, turned into arms: each selected item becomes an arm, in the
 * order it was clicked, and the rest of the selection stays as the cohort being split. A
 * categorical chart's selection is one clause listing its values; each clicked histogram bin is
 * its own range clause; the gene tables share one OQL clause whose entries are split out by kind.
 * Returns null when the chart has nothing selected.
 */
export function armsFromSelection(draft: { all: Clause[] }, chart: ChartKey):
  { base: { all: Clause[] }; arms: PartitionArm[] } | null {
  const rest: Clause[] = [];
  const arms: PartitionArm[] = [];
  for (const c of draft.all) {
    const l = c as Record<string, any>;
    if (chart.kind === "clinical" && l.kind === "clinical" && l.attribute === chart.attribute
      && (l.per || "patient") === (chart.per || "patient")) {
      const per = l.per === "sample" ? { per: "sample" as const } : {};
      if (Array.isArray(l.values)) for (const v of l.values)
        arms.push({ name: armLabel(String(v)), where: { kind: "clinical", attribute: l.attribute, ...per, values: [v] } });
      else if (l.op === "=" && l.value != null)
        arms.push({ name: armLabel(String(l.value)), where: { kind: "clinical", attribute: l.attribute, ...per, values: [l.value] } });
      else if (l.range) arms.push({ name: armLabel(rangeLabel(l.range)), where: c });
      else if (l.op) arms.push({ name: armLabel(l.op + " " + l.value), where: c });
      else rest.push(c);
      continue;
    }
    if (chart.kind === "genes" && l.kind === "oql") {
      const entries = String(l.q).split(";").map((e) => e.trim()).filter(Boolean);
      const mine = entries.filter((e) => chart.specs.some((s) => e.toUpperCase().endsWith(s)));
      for (const e of mine) arms.push({ name: armLabel(e), where: { kind: "oql", q: e } });
      const others = entries.filter((e) => !mine.includes(e));
      if (others.length) rest.push({ kind: "oql", q: others.join("; ") });
      continue;
    }
    rest.push(c);
  }
  if (!arms.length) return null;
  const seen = new Set<string>();
  for (const a of arms) {
    let n = a.name, k = 2;
    while (seen.has(n)) n = a.name + " " + k++;
    a.name = n; seen.add(n);
  }
  if (arms.length > 8) throw new Error("a split takes at most 8 arms, and " + arms.length + " items are selected in this chart — merge or deselect some first");
  return { base: { all: rest }, arms };
}

/**
 * Rename one child of a partition — an arm, or the remainder — and everything that refers to it
 * by name: views listing the child, and partitions splitting it further.
 */
export function renamePartitionChild<D extends { partitions?: Record<string, PartitionDef>; views?: unknown[] }>(
  doc: D, partition: string, from: string, to: string): D {
  const p = doc.partitions?.[partition];
  if (!p) throw new Error("no partition “" + partition + "”");
  const label = to.trim();
  if (!label) throw new Error("a name cannot be empty");
  if (label.length > 80) throw new Error("names are at most 80 characters");
  if (label === from) return doc;
  const labels = [...p.arms.map((a) => a.name), p.other || "Other"];
  if (labels.includes(label)) throw new Error("this split already has a row named “" + label + "”");
  const isOther = (p.other || "Other") === from;
  const next: PartitionDef = isOther ? { ...p, other: label }
    : { ...p, arms: p.arms.map((a) => a.name === from ? { ...a, name: label } : a) };
  const oldName = partition + " / " + from, newName = partition + " / " + label;
  const partitions = Object.fromEntries(Object.entries(doc.partitions!).map(([k, d]) =>
    [k, k === partition ? next : d.of === oldName ? { ...d, of: newName } : d]));
  const views = (doc.views || []).map((v) => {
    const cs = (v as { cohorts?: string[] }).cohorts;
    return Array.isArray(cs) ? { ...(v as object), cohorts: cs.map((c) => c === oldName ? newName : c) } : v;
  });
  return { ...doc, partitions, views } as D;
}
