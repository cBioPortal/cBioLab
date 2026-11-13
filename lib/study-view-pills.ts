/**
 * Explore's filter bar as the Study View draws it (STV-FB-1…5): each chart's filter is
 * "<chart name> : <pill> or <pill>", a value per pill for a categorical chart and an interval per
 * pill for a numeric one ("50 < x ≤ 55", its ends editable). Clauses that belong to no clinical
 * chart (genes, case lists, timelines, …) are left to the generic pills.
 */
import type { ClinicalLeaf, CohortDef } from "./types.ts";
import { chartLeaves, isNaClause } from "./explore-selection.ts";

type Clause = NonNullable<CohortDef["all"]>[number];

/** a numeric pill's text, its two ends kept apart so each can be edited */
export type Interval =
  | { kind: "point"; value: number }
  | { kind: "range"; lo?: number; loIn: boolean; hi?: number; hiIn: boolean };

export type SvPill =
  | { kind: "value"; leaf: number; value: string | number }
  | { kind: "interval"; leaf: number; interval: Interval }
  | { kind: "na" };

export type SvGroup =
  | { kind: "chart"; clause: number; attribute: string; label: string; pills: SvPill[] }
  | { kind: "other"; clause: number };

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** a clinical leaf's numbers as an interval; null for a value list or a word */
export function leafInterval(l: ClinicalLeaf): Interval | null {
  if (l.op === "=" && isNum(l.value)) return { kind: "point", value: l.value };
  if (!l.range) return null;
  const r = l.range as { gt?: number; gte?: number; lt?: number; lte?: number };
  const lo = r.gt ?? r.gte, hi = r.lt ?? r.lte;
  if (lo == null && hi == null) return null;
  return { kind: "range", lo, loIn: r.gt == null && r.gte != null, hi, hiIn: r.lt == null && r.lte != null };
}

/** STV-FB-4's text: "a < x ≤ b", "a ≤ x ≤ b", "> a", "≥ a", "≤ b", "< b", or the one value */
export function intervalText(iv: Interval): string {
  if (iv.kind === "point") return String(iv.value);
  const loS = iv.loIn ? "≤" : "<", hiS = iv.hiIn ? "≤" : "<";
  if (iv.lo != null && iv.hi != null) return `${iv.lo} ${loS} x ${hiS} ${iv.hi}`;
  if (iv.lo != null) return (iv.loIn ? "≥ " : "> ") + iv.lo;
  return hiS + " " + iv.hi;
}

/** the filter bar's groups, in the draft's clause order; `labelOf` names a chart by its attribute */
export function filterGroups(draft: CohortDef | null | undefined, labelOf: (attribute: string) => string | undefined): SvGroup[] {
  return (draft?.all || []).map((c, i): SvGroup => {
    const na = (c as { not?: ClinicalLeaf }).not;
    if (na && isNaClause(c, na.attribute)) return { kind: "chart", clause: i, attribute: na.attribute, label: labelOf(na.attribute) || na.attribute, pills: [{ kind: "na" }] };
    const attribute = clauseAttribute(c);
    const leaves = attribute ? chartLeaves(c, attribute) : null;
    if (!attribute || !leaves) return { kind: "other", clause: i };
    const pills: SvPill[] = [];
    leaves.forEach((l, j) => {
      const iv = leafInterval(l);
      if (iv) pills.push({ kind: "interval", leaf: j, interval: iv });
      else if (l.op === "=") pills.push({ kind: "value", leaf: j, value: l.value! });
      else for (const v of l.values || []) pills.push({ kind: "value", leaf: j, value: v });
    });
    return { kind: "chart", clause: i, attribute, label: labelOf(attribute) || attribute, pills };
  });
}

function clauseAttribute(c: Clause): string | null {
  const any = (c as { any?: ClinicalLeaf[] }).any;
  const l = Array.isArray(any) ? any[0] : c as ClinicalLeaf;
  return l && l.kind === "clinical" && typeof l.attribute === "string" ? l.attribute : null;
}

const leavesOf = (c: Clause): ClinicalLeaf[] => (c as { any?: ClinicalLeaf[] }).any || [c as ClinicalLeaf];

/** the draft with clause `i`'s leaves replaced: unwrapped when one is left, the clause dropped when none */
function withLeaves(draft: CohortDef, i: number, leaves: ClinicalLeaf[]): CohortDef {
  const all = [...(draft.all || [])];
  if (!leaves.length) all.splice(i, 1);
  else all[i] = leaves.length === 1 ? leaves[0] : { any: leaves };
  return { ...draft, all };
}

/** A pill's ×: a value leaves its list, an interval or NA its clause; the chart's filter goes with its last pill. */
export function removePill(draft: CohortDef, clause: number, pill: SvPill): CohortDef {
  const c = draft.all?.[clause];
  if (!c) return draft;
  if (pill.kind === "na") return withLeaves(draft, clause, []);
  const leaves = leavesOf(c);
  const l = leaves[pill.leaf];
  if (pill.kind === "value" && l && Array.isArray(l.values)) {
    const rest = l.values.filter((v) => v !== pill.value);
    const next: ClinicalLeaf | null = !rest.length ? null : rest.length === 1
      ? { kind: "clinical", attribute: l.attribute, op: "=", value: rest[0] } : { ...l, values: rest };
    return withLeaves(draft, clause, leaves.flatMap((x, j) => j !== pill.leaf ? [x] : next ? [next] : []));
  }
  return withLeaves(draft, clause, leaves.filter((_, j) => j !== pill.leaf));
}

/**
 * An edited end of an interval pill (STV-FB-4): a number, never empty. A start typed past the end
 * (or an end before the start) swaps them, keeping each side's bound; start = end is refused.
 */
export function editInterval(draft: CohortDef, clause: number, leaf: number, end: "lo" | "hi" | "point", raw: string): { draft: CohortDef } | { why: string } {
  const c = draft.all?.[clause];
  const leaves = c ? leavesOf(c) : [];
  const l = leaves[leaf];
  const iv = l && leafInterval(l);
  if (!iv) return { why: "that filter has no interval to edit" };
  const t = raw.trim();
  const v = Number(t);
  if (!t || !Number.isFinite(v)) return { why: "an interval's end is a number" };
  let next: ClinicalLeaf;
  if (iv.kind === "point" || end === "point") next = { kind: "clinical", attribute: l.attribute, op: "=", value: v };
  else {
    let { lo, hi } = iv;
    const { loIn, hiIn } = iv;
    if (end === "lo") lo = v; else hi = v;
    if (lo != null && hi != null) {
      if (lo === hi) return { why: "an interval's start and end must differ" };
      if (lo > hi) [lo, hi] = [hi, lo];
    }
    const range: { gt?: number; gte?: number; lt?: number; lte?: number } = {};
    if (lo != null) range[loIn ? "gte" : "gt"] = lo;
    if (hi != null) range[hiIn ? "lte" : "lt"] = hi;
    next = { kind: "clinical", attribute: l.attribute, range };
  }
  return { draft: withLeaves(draft, clause, leaves.map((x, j) => j === leaf ? next : x)) };
}
