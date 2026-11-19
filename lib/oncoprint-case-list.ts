// The OncoPrint's "case list order" (ONC-SO-3): columns in the order a user-defined case list
// typed them, as the portal's Sort › "Sort by case list order" (ResultsViewOncoprint sortOrder,
// ResultsViewPageStore givenSampleOrder). Pure apart from reading the request's stored id sets.
import { idSetIfLoaded } from "./id-sets.ts";

/** a user-defined list's ids for one study, bare, in typed order, and what they name */
export interface CaseList { level: "sample" | "patient"; ids: string[] }

type Leaf = { kind?: unknown; set?: unknown; ids?: unknown; part?: unknown };

/**
 * The user-defined case list a cohort is chosen by: the first `sampleList` / `patientList` clause
 * of its top-level `all`, its ids for `study` in the order typed (a stored set keeps that order,
 * lib/id-sets.ts tidyIdSet). null when the cohort names no such list, or a lock's part of one.
 */
export function caseListOf(dsl: unknown, study: string): CaseList | null {
  const all = dsl && typeof dsl === "object" ? (dsl as { all?: unknown }).all : null;
  if (!Array.isArray(all)) return null;
  const leaf = all.find((c: Leaf) => c && (c.kind === "sampleList" || c.kind === "patientList") && !c.part) as Leaf | undefined;
  if (!leaf) return null;
  const level = leaf.kind === "sampleList" ? "sample" : "patient";
  if (typeof leaf.set === "string") {
    const s = idSetIfLoaded(leaf.set);
    return s ? { level, ids: s.perStudy[study] || [] } : null;
  }
  if (!Array.isArray(leaf.ids)) return null;
  const pre = study + ":";
  return { level, ids: leaf.ids.filter((x): x is string => typeof x === "string" && x.startsWith(pre)).map((x) => x.slice(pre.length)) };
}

/**
 * Each column's place in the list: a column the list names takes its id's position; a patient
 * column of a sample list its first sample's (the portal's uniq of the samples' patients); a
 * sample column of a patient list its patient's. A column the list does not reach is left out,
 * and sorts after every listed one.
 */
export function caseListRanks(list: CaseList, columns: readonly string[], unit: "patient" | "sample",
  samplesOf: (column: string) => readonly string[] | undefined, patientOf?: (sample: string) => string | undefined): Map<string, number> {
  const pos = new Map<string, number>();
  list.ids.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  const out = new Map<string, number>();
  for (const c of columns) {
    let r: number | undefined;
    if (unit === list.level) r = pos.get(c);
    else if (unit === "patient") {
      for (const s of samplesOf(c) || []) { const p = pos.get(s); if (p !== undefined && (r === undefined || p < r)) r = p; }
    } else {
      const p = patientOf?.(c);
      r = p === undefined ? undefined : pos.get(p);
    }
    if (r !== undefined) out.set(c, r);
  }
  return out;
}
