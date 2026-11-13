/**
 * What a click on an Explore chart does to the draft (the Study View's chart selections).
 *
 * A clinical chart owns the top-level clauses that constrain only its attribute: a value list
 * (`=` / `values`), a range, or an `any` of those leaves. Bars and slices of one chart are
 * alternatives, so they OR inside that chart's clause; charts AND with each other (STS-FL-1).
 * A click toggles: a selected bar or value is taken out again (STS-PIE-6).
 */
import type { ClinicalLeaf, CohortDef, NumericBin } from "./types.ts";

type Clause = NonNullable<CohortDef["all"]>[number];

/** a cohort's `any` holds at most this many leaves (lib/cohort2.ts) */
export const ANY_LEAF_LIMIT = 8;

const isPlainLeaf = (c: unknown, attribute: string): c is ClinicalLeaf => {
  const l = c as ClinicalLeaf | null;
  return !!l && l.kind === "clinical" && l.attribute === attribute && !(l as { percentile?: unknown }).percentile &&
    (l.op === "=" || Array.isArray(l.values) || (!!l.range && l.op == null));
};

/** the leaves of a top-level clause, when it is one of this chart's selections; otherwise null */
export function chartLeaves(c: Clause, attribute: string): ClinicalLeaf[] | null {
  if (isPlainLeaf(c, attribute)) return [c];
  const any = (c as { any?: unknown[] }).any;
  return Array.isArray(any) && any.length && any.every((l) => isPlainLeaf(l, attribute)) ? any as ClinicalLeaf[] : null;
}

/** each of the chart's own clauses, as its OR'd leaves; every one of them must hold */
export function chartSelection(draft: CohortDef | null | undefined, attribute: string): ClinicalLeaf[][] {
  return (draft?.all || []).map((c) => chartLeaves(c, attribute)).filter((x): x is ClinicalLeaf[] => !!x);
}

type Interval = { lo: number; loIn: boolean; hi: number; hiIn: boolean };

/** the numbers a bar covers: (start, end], ≤ end, > start, or the one value start = end */
function binInterval(b: NumericBin): Interval | null {
  if (b.value != null) return null;
  if (b.special === "<=") return { lo: -Infinity, loIn: false, hi: b.end!, hiIn: true };
  if (b.special === ">") return { lo: b.start!, loIn: false, hi: Infinity, hiIn: false };
  if (b.start === b.end) return { lo: b.start!, loIn: true, hi: b.end!, hiIn: true };
  return { lo: b.start!, loIn: false, hi: b.end!, hiIn: true };
}

/** whether a leaf holds every value of a bar */
function encloses(l: ClinicalLeaf, b: NumericBin): boolean {
  if (b.value != null) {
    const fold = (v: unknown) => String(v).trim().toLowerCase();
    return (l.values || (l.op === "=" ? [l.value] : [])).some((v) => fold(v) === fold(b.value));
  }
  const iv = binInterval(b)!;
  if (l.op === "=") return typeof l.value === "number" && iv.lo === iv.hi && l.value === iv.lo;
  if (Array.isArray(l.values)) return iv.lo === iv.hi && l.values.some((v) => Number(v) === iv.lo);
  const r = l.range || {};
  const lowOk = r.gte != null ? iv.lo >= r.gte
    : r.gt != null ? (iv.lo > r.gt || (iv.lo === r.gt && !iv.loIn)) : true;
  const highOk = r.lte != null ? iv.hi <= r.lte
    : r.lt != null ? (iv.hi < r.lt || (iv.hi === r.lt && !iv.hiIn)) : true;
  return lowOk && highOk;
}

/** whether the chart's selection holds this bar (`isDataBinSelected`): some leaf of every clause encloses it */
export function binSelected(sel: ClinicalLeaf[][], b: NumericBin): boolean {
  return sel.length > 0 && sel.every((leaves) => leaves.some((l) => encloses(l, b)));
}

/**
 * The leaves selecting exactly these bars: each run of neighbouring interval bars as one range,
 * one-value bars as `=`, word bars as one value list. A run that spans both outlier bars has no
 * bound at all, so it is written as two ranges at an edge inside it.
 */
export function binsToLeaves(attribute: string, bins: NumericBin[], on: boolean[]): ClinicalLeaf[] {
  const out: ClinicalLeaf[] = [];
  const words = bins.filter((b, i) => on[i] && b.value != null).map((b) => b.value!);
  let run: NumericBin[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0], last = run[run.length - 1];
    if (run.length === 1 && first.special == null && first.start === first.end) out.push({ kind: "clinical", attribute, op: "=", value: first.start! });
    else if (first.special === "<=" && last.special === ">") {
      const mid = first.end!;
      out.push({ kind: "clinical", attribute, range: { lte: mid } }, { kind: "clinical", attribute, range: { gt: mid } });
    } else {
      const discreteLow = first.special == null && first.start === first.end;
      const lower = first.special === "<=" ? {} : discreteLow ? { gte: first.start! } : { gt: first.start! };
      const upper = last.special === ">" ? {} : { lte: last.end! };
      out.push({ kind: "clinical", attribute, range: { ...lower, ...upper } });
    }
    run = [];
  };
  bins.forEach((b, i) => {
    if (b.value != null || !on[i]) { flush(); return; }
    const prev = run[run.length - 1];
    // neighbours: the previous bar ends where this one starts, or two one-value bars side by side
    const joins = prev && (prev.end === b.start || (prev.start === prev.end && b.start === b.end));
    if (!joins) flush();
    run.push(b);
  });
  flush();
  if (words.length) out.push({ kind: "clinical", attribute, values: words });
  return out;
}

/** a clause from leaves: one leaf alone, several OR'd */
const asClause = (leaves: ClinicalLeaf[]): Clause => leaves.length === 1 ? leaves[0] : { any: leaves };

/** the draft with every clause of this chart replaced by `clause` (dropped when null), in the first one's place */
function replaceChart(draft: CohortDef | null | undefined, attribute: string, clause: Clause | null): CohortDef {
  const all = draft?.all || [];
  const at = all.findIndex((c) => chartLeaves(c, attribute));
  const rest = all.filter((c) => !chartLeaves(c, attribute));
  if (clause) rest.splice(at < 0 ? rest.length : at, 0, clause);
  return { ...(draft || {}), all: rest };
}

/**
 * A click on bar `i` of a clinical histogram: the bar joins the chart's selection, or leaves it if
 * it was in. Refused, saying why, past the number of separate ranges one clause can hold.
 */
export function toggleBin(draft: CohortDef | null | undefined, attribute: string, bins: NumericBin[], i: number): { draft: CohortDef } | { why: string } {
  const sel = chartSelection(draft, attribute);
  const on = bins.map((b) => binSelected(sel, b));
  on[i] = !on[i];
  const leaves = binsToLeaves(attribute, bins, on);
  if (leaves.length > ANY_LEAF_LIMIT)
    return { why: "a chart's selection holds at most " + ANY_LEAF_LIMIT + " separate ranges; select neighbouring bars to join them into one" };
  return { draft: replaceChart(draft, attribute, leaves.length ? asClause(leaves) : null) };
}

/** the values a chart's clauses select, when they are one plain value list (`=` or `values`) */
function chartValues(draft: CohortDef | null | undefined, attribute: string): (string | number)[] | null {
  const sel = chartSelection(draft, attribute);
  if (sel.length !== 1 || sel[0].length !== 1) return null;
  const l = sel[0][0];
  return l.range ? null : l.op === "=" ? [l.value!] : l.values || null;
}

/** the clause selecting a chart's NA: cases with no value of the attribute (none recorded, or a spelling of NA) */
export const naClause = (attribute: string): Clause => ({ not: { kind: "clinical", attribute, op: "!=", value: "" } });
export const isNaClause = (c: Clause, attribute: string): boolean => {
  const n = (c as { not?: ClinicalLeaf }).not;
  return !!n && n.kind === "clinical" && n.attribute === attribute && n.op === "!=" && n.value === "";
};
/** whether the draft selects this chart's NA */
export const naSelected = (draft: CohortDef | null | undefined, attribute: string): boolean =>
  (draft?.all || []).some((c) => isNaClause(c, attribute));

/** NA and values can't be OR'd in one clause yet: an `any` holds leaves, and NA is a negation */
const NA_WITH_VALUES = "NA can't be selected together with other values of the same chart; take those out first";

/** A click on a chart's NA slice or row: selected alone, or taken out again. */
export function toggleNa(draft: CohortDef | null | undefined, attribute: string): { draft: CohortDef } | { why: string } {
  const all = draft?.all || [];
  if (naSelected(draft, attribute)) return { draft: { ...(draft || {}), all: all.filter((c) => !isNaClause(c, attribute)) } };
  if (chartSelection(draft, attribute).length) return { why: NA_WITH_VALUES };
  return { draft: { ...(draft || {}), all: [...all, naClause(attribute)] } };
}

/**
 * A click on value `v` of a categorical chart: added to the chart's values, or taken out when it
 * is already one of them (matched as the facet folds them: case and surrounding space).
 */
export function toggleValue(draft: CohortDef | null | undefined, attribute: string, v: string): { draft: CohortDef } | { why: string } {
  if (naSelected(draft, attribute)) return { why: NA_WITH_VALUES };
  const fold = (x: unknown) => String(x).trim().toLowerCase();
  const cur = chartValues(draft, attribute) || [];
  const has = cur.some((x) => fold(x) === fold(v));
  const next = has ? cur.filter((x) => fold(x) !== fold(v)) : [...cur, v];
  const clause: ClinicalLeaf | null = !next.length ? null : next.length === 1
    ? { kind: "clinical", attribute, op: "=", value: next[0] } : { kind: "clinical", attribute, values: next };
  return { draft: replaceChart(draft, attribute, clause) };
}
