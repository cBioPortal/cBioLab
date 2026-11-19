// cBioPortal's generic-assay frequency table (STS-OT-5): one per binary or categorical generic-assay
// profile, a row per (entity, value) the selection holds. Which values are rows, the altered-only
// default of arm-level CNA and LOH tables, their order, and the clause a selection on them adds.
// No server imports, so the page, the engine and the tests read the same rules.
import { ANY_LEAF_LIMIT, ASSAY_VALUES_LIMIT, limitRefusal } from "./filter-limits.ts";

/** a row: an entity, one of its values, and the cases holding that value */
export interface FreqRow { entity: string; name: string; value: string; n: number }

/** values that are no answer, dropped from every table */
const NO_VALUE = ["", "na"];
/** a binary profile's "not present" values, dropped too (the table counts presence) */
const BINARY_ABSENT = ["0", "absent", "false", "n", "negative", "no"];

/** whether a value is one of the table's rows */
export function freqTableKeeps(value: string, binary: boolean): boolean {
  const v = value.trim().toLowerCase();
  return !NO_VALUE.includes(v) && !(binary && BINARY_ABSENT.includes(v));
}

/** the profile types whose tables show altered categories only until asked (the filter icon) */
export const ALTERED_ONLY_TYPES = ["ARMLEVEL_CNA", "LOH_HLA"];

/** an unchanged or unknown category, hidden from those tables by default */
export const unchangedCategory = (value: string): boolean => /^(unchanged|unknown)$/i.test(value.trim());

/** the curated category order of those tables: losses and deletions, then gains and amplifications, then the rest */
function categoryRank(value: string): number {
  const v = value.toLowerCase();
  return /loss/.test(v) ? 0 : /del/.test(v) ? 1 : /gain/.test(v) ? 2 : /amp/.test(v) ? 3 : 4;
}

/**
 * The rows shown, in order: an arm-level CNA or LOH table by category, then count, altered
 * categories only unless `all`; any other by count. Ties by entity, then value.
 */
export function freqTableRows<T extends FreqRow>(rows: T[], assayType: string | undefined, all: boolean): T[] {
  const curated = !!assayType && ALTERED_ONLY_TYPES.includes(assayType);
  return rows.filter((r) => !curated || all || !unchangedCategory(r.value))
    .sort((a, b) => (curated ? categoryRank(a.value) - categoryRank(b.value) : 0) || b.n - a.n || a.entity.localeCompare(b.entity) || a.value.localeCompare(b.value));
}

/** a row's key: entity and value */
export const freqRowKey = (r: { entity: string; value: string }): string => r.entity + "::" + r.value;

/**
 * The clause the checked rows add: the cases with any checked (entity, value), as the portal's
 * genericAssaySelectionFilters OR them. One genericAssay leaf per entity, an `any` of them for
 * several, or why that cannot be one filter.
 */
export function freqTableClause(profileType: string, keys: string[]): { clauses: unknown[] } | { why: string } {
  if (!keys.length) return { why: "no row is checked" };
  const byEntity = new Map<string, string[]>();
  for (const k of keys) {
    const at = k.lastIndexOf("::");
    const entity = k.slice(0, at), value = k.slice(at + 2);
    byEntity.set(entity, [...(byEntity.get(entity) || []), value]);
  }
  const tooMany = limitRefusal(byEntity.size, ANY_LEAF_LIMIT, "entities") ??
    [...byEntity.values()].map((v) => limitRefusal(v.length, ASSAY_VALUES_LIMIT, "values of one entity")).find(Boolean) ?? null;
  if (tooMany) return { why: tooMany };
  const leaves = [...byEntity].map(([entity, values]) => ({ kind: "genericAssay", profileType, entity, values }));
  return { clauses: [leaves.length === 1 ? leaves[0] : { any: leaves }] };
}
