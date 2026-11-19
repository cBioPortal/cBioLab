/**
 * Explore's filter bar as the Study View draws it (STV-FB-1…5): each chart's filter is
 * "<chart name> : <pill> or <pill>", a value per pill for a categorical chart and an interval for a
 * numeric one ("50 < x ≤ 55", its ends editable); several ranges of one chart are one pill, from
 * the first range's start to the last's end, as the portal writes them. Clauses that belong to no clinical
 * chart (genes, case lists, timelines, …) are left to the generic pills.
 */
import type { ClinicalLeaf, CohortDef } from "./types.ts";
import { chartLeaves, isNaClause } from "./explore-selection.ts";
import { STYLE } from "./oncoprint-style.ts";

type Clause = NonNullable<CohortDef["all"]>[number];

/** a numeric pill's text, its two ends kept apart so each can be edited */
export type Interval =
  | { kind: "point"; value: number }
  | { kind: "range"; lo?: number; loIn: boolean; hi?: number; hiIn: boolean };

/** an interval pill that stands for every range of its chart's filter (STV-FB-4) */
export const ALL_LEAVES = -1;

export type SvPill =
  | { kind: "value"; leaf: number; value: string | number }
  | { kind: "interval"; leaf: number; interval: Interval }
  | { kind: "na" };

export type SvGroup =
  | { kind: "chart"; clause: number; attribute: string; label: string; pills: SvPill[] }
  | { kind: "other"; clause: number }
  /** a density drag's range: no pill, as the portal's (STV-FB-3b); its chart shows and clears it */
  | { kind: "hidden"; clause: number };

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

/**
 * Several ranges of one chart as the portal writes them (STV-FB-4, intervalFiltersDisplayValue):
 * one interval from the lowest start to the highest end, each end keeping its own bound (open when
 * any range is open there), though it reads wider than the filter when the ranges have gaps.
 */
function mergedInterval(ivs: Interval[]): Interval {
  const ends = ivs.map((iv) => iv.kind === "point" ? { lo: iv.value, loIn: true, hi: iv.value, hiIn: true } : iv);
  const lows = ends.filter((e) => e.lo != null), highs = ends.filter((e) => e.hi != null);
  const lo = lows.length === ends.length ? Math.min(...lows.map((e) => e.lo!)) : undefined;
  const hi = highs.length === ends.length ? Math.max(...highs.map((e) => e.hi!)) : undefined;
  return { kind: "range", lo, loIn: lo != null && lows.some((e) => e.lo === lo && e.loIn), hi, hiIn: hi != null && highs.some((e) => e.hi === hi && e.hiIn) };
}

/** a chart's ranges, when its filter is two or more of them and nothing else */
function rangesOf(leaves: ClinicalLeaf[]): Interval[] | null {
  const ivs = leaves.map(leafInterval);
  return ivs.length > 1 && ivs.every((iv): iv is Interval => iv != null) ? ivs : null;
}

/** the filter bar's groups, in the draft's clause order; `labelOf` names a chart by its attribute */
export function filterGroups(draft: CohortDef | null | undefined, labelOf: (attribute: string) => string | undefined,
  /** the density charts drawn (densityChartName): a drag's ranges have no pill only while their chart shows them (STV-FB-3b) */
  drawnDensity: ReadonlySet<string> = new Set()): SvGroup[] {
  return (draft?.all || []).map((c, i): SvGroup => {
    if (drawnDensity.has(String((c as { chart?: unknown }).chart || ""))) return { kind: "hidden", clause: i };
    const na = (c as { not?: ClinicalLeaf }).not;
    if (na && isNaClause(c, na.attribute)) return { kind: "chart", clause: i, attribute: na.attribute, label: labelOf(na.attribute) || na.attribute, pills: [{ kind: "na" }] };
    const attribute = clauseAttribute(c);
    const leaves = attribute ? chartLeaves(c, attribute) : null;
    if (!attribute || !leaves) return { kind: "other", clause: i };
    const ranges = rangesOf(leaves);
    if (ranges) return { kind: "chart", clause: i, attribute, label: labelOf(attribute) || attribute, pills: [{ kind: "interval", leaf: ALL_LEAVES, interval: mergedInterval(ranges) }] };
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
  if (pill.kind === "na" || (pill.kind === "interval" && pill.leaf === ALL_LEAVES)) return withLeaves(draft, clause, []);
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
  // the one pill of several ranges: an edit makes the filter that one interval, as the portal's
  const all = leaf === ALL_LEAVES ? rangesOf(leaves) : null;
  const l = all ? leaves[0] : leaves[leaf];
  const iv = all ? mergedInterval(all) : l && leafInterval(l);
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
  return { draft: withLeaves(draft, clause, all ? [next] : leaves.map((x, j) => j === leaf ? next : x)) };
}

/** the numbers an interval pill's leaf now holds: its ends, or its one value */
export function intervalEnds(draft: CohortDef, clause: number, leaf: number): number[] {
  const c = draft.all?.[clause];
  const all = c && leaf === ALL_LEAVES ? rangesOf(leavesOf(c)) : null;
  // after an edit the one pill's filter is a single interval, read as itself
  const l = c && !all ? leavesOf(c)[leaf === ALL_LEAVES ? 0 : leaf] : undefined;
  const iv = all ? mergedInterval(all) : l && leafInterval(l);
  if (!iv) return [];
  return iv.kind === "point" ? [iv.value] : [iv.lo, iv.hi].filter((x): x is number => x != null);
}

/** one line a gene table's selection writes: a gene and the alteration its table counts (lib/study-view-gene-tables.ts geneSelection) */
const GENE_TABLE_LINE = /^([A-Za-z0-9][A-Za-z0-9.-]*):\s*(MUT|AMP|HOMDEL|FUSION)(_DRIVER)?$/;

export interface GenePill { gene: string; line: string; color: string }

/**
 * A gene table's selection as the portal's filter bar draws it (STV-FB-3 #9): each gene its own
 * pill, coloured by what its table counts (a mutation green, a structural variant purple, an
 * amplification red, a deep deletion blue, the oncoprint's colours), the OQL line in its tooltip.
 * Null when the clause is not one a gene table writes, which carries the table's name (`chart`):
 * typed OQL and a Gene status chart's clause, which can hold the same text, keep the generic pill.
 */
export function geneTablePills(c: unknown): GenePill[] | null {
  const l = c as { kind?: string; q?: unknown; chart?: unknown } | null;
  if (!l || l.kind !== "oql" || typeof l.q !== "string" || typeof l.chart !== "string") return null;
  const lines = l.q.split(";").map((x) => x.trim()).filter(Boolean);
  const out: GenePill[] = [];
  for (const line of lines) {
    const m = GENE_TABLE_LINE.exec(line);
    if (!m) return null;
    const g = STYLE.glyph;
    const color = m[2] === "MUT" ? g.mutation.single.color : m[2] === "FUSION" ? g.sv.color
      : g.cna.options.find((o) => o.bit === m[2])!.color;
    out.push({ gene: m[1], line, color });
  }
  return out.length ? out : null;
}

/** the draft without one gene of a gene-table clause (the portal removes that gene's query); the clause goes with its last gene */
export function removeOqlLine(draft: CohortDef, clause: number, line: string): CohortDef {
  const all = [...(draft.all || [])];
  const c = all[clause] as { kind: "oql"; q: string };
  const rest = c.q.split(";").map((x) => x.trim()).filter((x) => x && x !== line);
  if (rest.length) all[clause] = { ...c, q: rest.join("; ") } as never; else all.splice(clause, 1);
  return { ...draft, all };
}

/** which chart a generic clause comes from, as far as its leaves say: their kind, and the gene or entity of a genomic one */
function chartOfClause(c: unknown): string {
  const x = c as { any?: unknown[]; not?: unknown };
  const l = (Array.isArray(x?.any) ? x.any[0] : x?.not ?? c) as { kind?: string; gene?: string; profileType?: string; entity?: string; time?: string } | undefined;
  if (!l) return "";
  if (l.kind === "genomicData") return "genomicData|" + l.gene + "|" + l.profileType;
  if (l.kind === "genericAssay") return "genericAssay|" + l.profileType + "|" + l.entity;
  if (l.kind === "treatment") return "treatment|" + (l.time ? "sample" : "patient");
  return String(l.kind ?? "event");
}

/**
 * The words between the filter bar's groups (STV-FB-2): two generic groups in a row from the same
 * chart (two gene-table selections, two case-list selections) are joined by "and", as the portal
 * writes "( APC or TP53 ) and ( KRAS )"; a clinical chart's pill, or a group from another chart,
 * gets no word. One entry per group: whether "and" goes before it.
 */
export function joinedByAnd(draft: CohortDef | null | undefined, groups: SvGroup[]): boolean[] {
  const all = draft?.all || [];
  return groups.map((g, i) => {
    const prev = groups[i - 1];
    return i > 0 && g.kind === "other" && prev.kind === "other" && chartOfClause(all[g.clause]) === chartOfClause(all[prev.clause]);
  });
}
