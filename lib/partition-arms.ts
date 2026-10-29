// Building and editing a partition's arms — pure and browser-safe, shared by the server's "split
// by" proposal, Explore's "Compare groups" (arms as the comparison page's cohorts), the analysis
// page's partition panel and the assistant's tools, so every path picks arms by the same rule.
import type { Clause, CohortDef, Leaf, PartitionArm, PartitionDef, SplitDef } from "./types.ts";

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
export function partitionFromValues(of: string, attribute: string, values: ValueCount[],
  opts: { maxArms?: number; minCount?: number } = {}): { def: PartitionDef; pooled: string[] } {
  const minCount = opts.minCount ?? SPLIT_BY_DEFAULT_MIN_COUNT;
  const { own, pooled } = chooseArmValues(values, opts.maxArms, minCount);
  if (own.length < 1)
    throw new Error("no value of " + attribute + " is held by at least " + minCount + " patients in “" + of + "” — nothing to split on");
  const arms: PartitionArm[] = own.map((x) => ({
    name: armLabel(x.v),
    where: { kind: "clinical", attribute, values: [x.v] }
  }));
  return {
    def: { of, split: attribute, arms, source: { attribute, minCount, ...(pooled.length ? { otherValues: pooled.slice(0, 50).map((x) => x.v) } : {}) } },
    pooled: pooled.map((x) => x.v)
  };
}

/** A gene's mutated / wild-type split (not-profiled patients get their own child from the engine). */
export function partitionFromGene(of: string, gene: string): PartitionDef {
  const g = gene.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)) throw new Error("'" + gene + "' is not a valid gene symbol");
  return { of, split: g, arms: [{ name: g + " mutated", where: { kind: "oql", q: g + ": MUT" } }], other: g + " wild-type", source: { gene: g } };
}

/** One arm per OQL query, first match wins. */
export function partitionFromOql(of: string, queries: string[]): PartitionDef {
  const qs = queries.map((q) => q.trim()).filter(Boolean);
  if (!qs.length) throw new Error("give at least one OQL query");
  return { of, split: "OQL", arms: qs.map((q) => ({ name: armLabel(q), where: { kind: "oql", q } })), source: { oql: qs } };
}

export function armLabel(v: string): string {
  const s = String(v).trim() || "(blank)";
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}

/** the cut points of `n` equal-count groups: 2 → [0.5], 4 → [0.25, 0.5, 0.75] */
export function quantilePoints(n: number): number[] {
  if (!Number.isInteger(n) || n < 2 || n > 10) throw new Error("quantiles must be a whole number from 2 to 10, got " + n);
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

/** a number as an arm's name shows it: three significant figures, no grouping commas */
const cutText = (x: number): string => String(Number(x.toPrecision(3)));

/**
 * One arm per interval between ascending `cuts`: at or below the first, each (cut, next cut], and
 * above the last — the intervals a histogram bar uses, so every value lands in exactly one arm.
 * Cuts that coincide (a value shared by more than a group's worth of cases) are one cut, so tied
 * values never straddle two arms and no arm is empty by construction.
 */
export function rangeArms(label: string, cuts: number[], where: (range: { gt?: number; lte?: number }) => Clause): PartitionArm[] {
  const cs: number[] = [];
  for (const c of cuts) if (Number.isFinite(c) && (!cs.length || c > cs[cs.length - 1])) cs.push(c);
  if (!cs.length) throw new Error(label + " has no values to cut");
  const arms: PartitionArm[] = [{ name: armLabel(label + " ≤ " + cutText(cs[0])), where: where({ lte: cs[0] }) }];
  for (let i = 1; i < cs.length; i++)
    arms.push({ name: armLabel(label + " " + cutText(cs[i - 1]) + "–" + cutText(cs[i])), where: where({ gt: cs[i - 1], lte: cs[i] }) });
  arms.push({ name: armLabel(label + " > " + cutText(cs[cs.length - 1])), where: where({ gt: cs[cs.length - 1] }) });
  return arms;
}

/** the most groups the comparison page compares at once (its enrichment, table and assay views take 6 cohorts) */
export const COMPARISON_MAX_ACTIVE = 6;
/** the most groups it holds: those past COMPARISON_MAX_ACTIVE open taken out, and are swapped in by hand */
export const COMPARISON_MAX_GROUPS = 20;
/** the most clauses a cohort takes (lib/cohort2.ts) */
const COHORT_MAX_CLAUSES = 8;

/**
 * Groups for the comparison page from one chart: each arm is its own cohort, the selection's other
 * clauses (`base`) and the arm's own, evaluated where the selection is (`scope`: its study or
 * studies). Unlike a split's children these are not first-match-wins: a patient in two arms (two
 * genes' mutations) is in both groups, as on cBioPortal, and the page's Overlap tab shows it.
 */
export function comparisonCohorts(scope: Pick<CohortDef, "study" | "studies">, base: Clause[], arms: PartitionArm[]): Record<string, CohortDef> {
  if (arms.length < 2) throw new Error("a comparison needs at least 2 groups, and this chart gives " + arms.length);
  if (arms.length > COMPARISON_MAX_GROUPS)
    throw new Error("the comparison page holds at most " + COMPARISON_MAX_GROUPS + " groups, and this chart gives " + arms.length);
  if (base.length + 1 > COHORT_MAX_CLAUSES)
    throw new Error("each group would need " + (base.length + 1) + " conditions (the selection's " + base.length + " and its own), and a cohort takes at most " + COHORT_MAX_CLAUSES + " — remove a filter first");
  const out: Record<string, CohortDef> = {};
  for (const a of arms) {
    let n = a.name, k = 2;
    while (out[n]) n = a.name + " " + k++;
    out[n] = { ...(scope.study ? { study: scope.study } : {}), ...(scope.studies ? { studies: scope.studies } : {}), all: [...base, a.where] };
  }
  return out;
}

/**
 * The comparison page's "exclude overlapping samples": each group without the samples any other
 * group also holds. A group's own conditions plus "and not in any other group" — written as
 * clauses, so it stays a cohort definition the engine compiles like any other. Another group can
 * be subtracted when it differs from this one by a single condition (the groups a chart opens all
 * do: the selection's clauses and one arm each), since then not-in-it is not-that-condition;
 * anything else is refused, naming the two groups.
 */
export function exclusiveCohorts(groups: Record<string, CohortDef>): Record<string, CohortDef> {
  const key = (x: unknown) => JSON.stringify(x);
  const where = (d: CohortDef) => key([d.study || null, d.studies || null]);
  const out: Record<string, CohortDef> = {};
  for (const [name, g] of Object.entries(groups)) {
    if (g.lock || g.extends || g.a) throw new Error("“" + name + "” is not a plain list of conditions (a locked, inherited or event cohort), so its overlap with the other groups cannot be removed");
    const own = g.all || [], mine = new Set(own.map(key));
    const neg: Leaf[] = [], pos: Clause[] = [];
    for (const [other, o] of Object.entries(groups)) {
      if (other === name) continue;
      if (where(o) !== where(g)) throw new Error("“" + name + "” and “" + other + "” are evaluated over different studies, so their overlap cannot be removed");
      const diff = (o.all || []).filter((c) => !mine.has(key(c)));
      if (!diff.length) throw new Error("“" + name + "” lies wholly within “" + other + "”, so without the overlap it would be empty");
      if (diff.length > 1) throw new Error("“" + other + "” differs from “" + name + "” in " + diff.length + " conditions; overlap can be removed only between groups that differ in one");
      const c = diff[0] as any;
      if (c.not) { if (!mine.has(key(c.not)) && !pos.some((x) => key(x) === key(c.not))) pos.push(c.not); }
      else neg.push(...(c.any || [c]));
    }
    const leaves = [...new Map(neg.map((l) => [key(l), l])).values()];
    if (leaves.length > COHORT_MAX_CLAUSES) throw new Error("removing the overlap from “" + name + "” needs " + leaves.length + " conditions in one “not any of”, and it takes at most " + COHORT_MAX_CLAUSES);
    const all = [...own, ...pos, ...(leaves.length ? [{ not: { any: leaves } }] : [])];
    if (all.length > COHORT_MAX_CLAUSES) throw new Error("“" + name + "” without the overlap would need " + all.length + " conditions, and a cohort takes at most " + COHORT_MAX_CLAUSES);
    out[name] = { ...g, all };
  }
  return out;
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
    && (l as { attribute: string }).attribute === (leaves[0] as { attribute: string }).attribute);
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
  | { kind: "clinical"; attribute: string }
  /** a gene table: the OQL entries of one alteration kind (": MUT", ": AMP"/": HOMDEL", ": FUSION") */
  | { kind: "genes"; specs: string[] }
  /** one generic-assay entity's chart */
  | { kind: "assay"; profileType: string; entity: string };

/** a split takes at most this many arms */
const MAX_SELECTION_ARMS = 8;

/** the draft's clauses split into the ones that are this chart's selection (as arms) and the rest */
function chartSelection(draft: { all: Clause[] }, chart: ChartKey): { rest: Clause[]; arms: PartitionArm[] } {
  const rest: Clause[] = [];
  const arms: PartitionArm[] = [];
  for (const c of draft.all) {
    const l = c as Record<string, any>;
    if (chart.kind === "clinical" && l.kind === "clinical" && l.attribute === chart.attribute) {
      if (Array.isArray(l.values)) for (const v of l.values)
        arms.push({ name: armLabel(String(v)), where: { kind: "clinical", attribute: l.attribute, values: [v] } });
      else if (l.op === "=" && l.value != null)
        arms.push({ name: armLabel(String(l.value)), where: { kind: "clinical", attribute: l.attribute, values: [l.value] } });
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
    if (chart.kind === "assay" && l.kind === "genericAssay" && l.profileType === chart.profileType && l.entity === chart.entity) {
      if (Array.isArray(l.values)) for (const v of l.values) arms.push({ name: armLabel(String(v)), where: { ...l, values: [v] } as Leaf });
      else if (l.range) arms.push({ name: armLabel(rangeLabel(l.range)), where: c });
      else rest.push(c);
      continue;
    }
    rest.push(c);
  }
  return { rest, arms };
}

/** arms named uniquely, refused past the most a split takes */
function nameArms(arms: PartitionArm[], what: string): PartitionArm[] {
  const seen = new Set<string>();
  const named = arms.map((a) => {
    let n = a.name, k = 2;
    while (seen.has(n)) n = a.name + " " + k++;
    seen.add(n);
    return { ...a, name: n };
  });
  if (named.length > MAX_SELECTION_ARMS) throw new Error("a split takes at most " + MAX_SELECTION_ARMS + " arms, and " + named.length + " " + what + " — merge or deselect some first");
  return named;
}

/**
 * Explore's selection in ONE chart, turned into arms: each selected item becomes an arm, in the
 * order it was clicked, and the rest of the selection stays as the cohort being split. A
 * categorical chart's selection is one clause listing its values; each clicked histogram bin is
 * its own range clause; the gene tables share one OQL clause whose entries are split out by kind.
 * Returns null when the chart has nothing selected.
 */
export function armsFromSelection(draft: { all: Clause[] }, chart: ChartKey):
  { base: { all: Clause[] }; arms: PartitionArm[] } | null {
  const { rest, arms } = chartSelection(draft, chart);
  if (!arms.length) return null;
  return { base: { all: rest }, arms: nameArms(arms, "items are selected in this chart") };
}

/**
 * The draft without a chart's own clauses — what groups given item by item (a chart's checked rows
 * or bars) are drawn from: only those items divide it, whatever the chart already filters it by.
 */
export function withoutChart(draft: { all: Clause[] }, chart: ChartKey): Clause[] {
  return chartSelection(draft, chart).rest;
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
  // everything beneath the renamed row is named after it: nested splits' owners, and views
  const oldName = partition + " / " + from, newName = partition + " / " + label;
  const move = (c: string) => c === oldName ? newName : c.startsWith(oldName + " / ") ? newName + c.slice(oldName.length) : c;
  const partitions = Object.fromEntries(Object.entries(doc.partitions!).map(([k, d]) =>
    [move(k), k === partition ? next : { ...d, of: move(d.of) }]));
  return { ...doc, partitions, views: renameInViews(doc.views, oldName, newName) } as D;
}

/** what expandSplits needs to know about one partition */
export interface PartitionShape { name: string; of: string; comparable: string[] }

/**
 * What a view's cohort list draws. A cohort's name is that whole cohort, split or not; a split's
 * name ("<cohort> / <split>") is its arms and remainder (its not-evaluable children are disclosed
 * in the split, not compared); an arm's name is that arm. Each view chooses for itself, so one
 * view can show a cohort while another shows its split. Used by the engine and by the page's
 * cohort pickers alike, so the two cannot disagree.
 */
export function expandSplits(names: string[], parts: PartitionShape[]): string[] {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const out = names.flatMap((n) => byName.get(n)?.comparable ?? [n]);
  return out.filter((n, i) => out.indexOf(n) === i);
}

/**
 * The splits a view's cohort list draws from: a split's own name counts as that split, a group's
 * name as the split it belongs to (the deepest split whose name prefixes it); a whole cohort counts
 * as none. A view may draw from at most one split — groups of two splits, even of different
 * cohorts, are two separate comparisons, and two splits of one cohort count every patient twice.
 */
export function splitsDrawn(names: string[], parts: PartitionShape[]): string[] {
  const owners = names.map((n) => {
    if (parts.some((p) => p.name === n)) return n;
    const under = parts.filter((p) => n.startsWith(p.name + " / ")).sort((a, b) => b.name.length - a.name.length);
    return under[0]?.name ?? null;
  }).filter((x): x is string => !!x);
  return owners.filter((n, i) => owners.indexOf(n) === i);
}

/**
 * Why a view's cohort list cannot be drawn, or null. A view draws EITHER whole cohorts OR the groups
 * of one split: two splits count patients twice or ask two questions at once, and a whole cohort
 * beside a split's groups can share their patients (EGFR-mutant NSCLC is partly inside NSCLC's
 * "KRAS wild-type").
 */
export function viewDrawProblem(names: string[], parts: PartitionShape[]): string | null {
  const splits = splitsDrawn(names, parts);
  if (splits.length > 1)
    return "a view draws the groups of one split; this one names " + splits.map((n) => "“" + n + "”").join(" and ") + " — choose one";
  if (splits.length === 1) {
    const whole = names.filter((n) => splitsDrawn([n], parts).length === 0);
    if (whole.length)
      return "a view draws whole cohorts or the groups of one split, not both; this one names " +
        whole.map((n) => "“" + n + "”").join(", ") + " beside “" + splits[0] + "” — choose one";
  }
  return null;
}

// ---- the split tree (stored on cohorts) and its flat working form ---------------------------

type Cohorts = Record<string, CohortDef>;

/** "<owner> / <split>": how a split is addressed, and the prefix of every child it makes */
export function splitKey(of: string, split: string): string { return of + " / " + split; }

/**
 * Every split in the document as a flat map keyed "<owner> / <split>", each knowing what it
 * splits. The owner is a cohort's name or an arm's full name ("NSCLC / KRAS allele / G12C"), so a
 * split nested under an arm is keyed "NSCLC / KRAS allele / G12C / sex". Arms come back without
 * their nested splits — those are entries of their own.
 */
export function flattenSplits(cohorts: Cohorts): Record<string, PartitionDef> {
  const out: Record<string, PartitionDef> = {};
  const walk = (of: string, splits: Record<string, SplitDef> | undefined) => {
    for (const [split, d] of Object.entries(splits || {})) {
      if (!d || typeof d !== "object") throw new Error("split “" + split + "” of “" + of + "” must be an object");
      const key = splitKey(of, split);
      const { arms, otherSplits, ...rest } = d;
      out[key] = { ...rest, of, split, arms: (Array.isArray(arms) ? arms : []).map(({ splits: _s, ...a }) => a) };
      for (const a of Array.isArray(arms) ? arms : []) if (a && a.splits) walk(splitKey(key, String(a.name)), a.splits);
      if (otherSplits) walk(splitKey(key, d.other || "Other"), otherSplits);
    }
  };
  for (const [name, def] of Object.entries(cohorts || {})) walk(name, def?.splits);
  return out;
}

/** The cohorts without their splits: what the compiler (and a federated peer) is given. */
export function withoutSplitTrees(cohorts: Cohorts): Cohorts {
  return Object.fromEntries(Object.entries(cohorts || {}).map(([n, d]) => {
    if (!d || !d.splits) return [n, d];
    const { splits: _s, ...rest } = d;
    return [n, rest];
  }));
}

/**
 * Write a flat map of splits back onto the cohorts as a tree (replacing whatever splits they had).
 * A split whose owner is neither a cohort nor an arm / remainder of another split is refused by
 * name rather than dropped.
 */
export function unflattenSplits(cohorts: Cohorts, flat: Record<string, PartitionDef>): Cohorts {
  const out: Cohorts = Object.fromEntries(Object.entries(withoutSplitTrees(cohorts)).map(([n, d]) => [n, { ...d }]));
  const built = new Map<string, SplitDef>();
  const entries = Object.values(flat).map((p) => ({ key: splitKey(p.of, p.split), p }));
  const attach = (key: string, p: PartitionDef, chain: string[]) => {
    if (built.has(key)) return;
    if (chain.includes(key)) throw new Error("split “" + key + "” splits its own descendant");
    const { of, split, arms, ...rest } = p;
    const def: SplitDef = { ...rest, arms: arms.map((a) => ({ ...a })) };
    if (out[of]) {
      out[of] = { ...out[of], splits: { ...(out[of].splits || {}), [split]: def } };
    } else {
      // the nearest enclosing split: every split above it is a prefix of `of` too
      const parent = entries.filter((e) => of.startsWith(e.key + " / ")).reduce<typeof entries[number] | undefined>(
        (best, e) => !best || e.key.length > best.key.length ? e : best, undefined);
      if (!parent) throw new Error("split “" + split + "” is of “" + of + "”, which is not a cohort or an arm of a split");
      attach(parent.key, parent.p, [...chain, key]);
      const pd = built.get(parent.key)!;
      const label = of.slice(parent.key.length + 3);
      const arm = pd.arms.find((a) => a.name === label);
      if (arm) arm.splits = { ...(arm.splits || {}), [split]: def };
      else if ((pd.other || "Other") === label) pd.otherSplits = { ...(pd.otherSplits || {}), [split]: def };
      else throw new Error("split “" + split + "” is of “" + of + "”, which is not an arm of “" + parent.key + "”");
    }
    built.set(key, def);
  };
  for (const e of entries) attach(e.key, e.p, []);
  return out;
}

/**
 * Edit a document's splits through their flat form (splits nested under an arm the edit removed
 * are dropped with it): `edit` gets {partitions, views} — the shape
 * withoutPartition / renamePartitionChild work on — and the result is written back as a tree.
 */
export function editSplits<D extends { cohorts: Cohorts; views?: unknown[] }>(
  doc: D, edit: (flat: { partitions: Record<string, PartitionDef>; views?: unknown[] }) => { partitions?: Record<string, PartitionDef>; views?: unknown[] }): D {
  const out = edit({ partitions: flattenSplits(doc.cohorts), views: doc.views });
  // a split of an arm that no longer exists goes with it, as a cohort's splits go with the cohort
  const flat = { ...(out.partitions || {}) };
  const owns = (of: string) => !!doc.cohorts[of] || Object.entries(flat).some(([k, p]) =>
    of.startsWith(k + " / ") && [...p.arms.map((a) => a.name), p.other || "Other"].includes(of.slice(k.length + 3)));
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, p] of Object.entries(flat)) if (!owns(p.of)) { delete flat[k]; changed = true; }
  }
  return { ...doc, cohorts: unflattenSplits(doc.cohorts, flat), views: out.views } as D;
}

/** Rewrite a cohort name, and every name beneath it, in views' cohort lists. */
export function renameInViews(views: unknown[] | undefined, from: string, to: string): unknown[] | undefined {
  const re = (c: string) => c === from ? to : c.startsWith(from + " / ") ? to + c.slice(from.length) : c;
  return views && views.map((v) => {
    const cs = (v as { cohorts?: string[] }).cohorts;
    return Array.isArray(cs) ? { ...(v as object), cohorts: cs.map(re) } : v;
  });
}

/** A view that names no cohorts draws nothing yet: it waits for one. A `splitBy` view draws its split's arms. */
export function viewIsEmpty(v: unknown): boolean {
  const x = (v || {}) as { cohorts?: unknown; splitBy?: unknown };
  return !x.splitBy && !(Array.isArray(x.cohorts) && x.cohorts.length > 0);
}
