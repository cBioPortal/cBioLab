// Saving a list of sample or patient ids as a stored id set (lib/id-set-store.ts): matched to the
// studies' own cases first, so a set never names a case that is not there, and what did not match
// is reported rather than silently left out.
import { saveIdSet, ID_SET_MAX, type IdSetMeta } from "./id-set-store.ts";
import { resolveCaseIds } from "./custom-data-server.ts";
import type { IdSetLevel } from "./id-sets.ts";

/** What saving a list did: the set, and what of the list did not match. */
export interface IdSetCreated {
  set: IdSetMeta;
  unmatched: number;
  /** the first few ids that matched nothing, to show */
  unmatchedExamples: string[];
  /** ids given more than once */
  duplicates: number;
  /** bare ids found in more than one of the studies: each is kept in every one */
  multiStudy: number;
  /** studies not matched against, and why */
  refused: { study: string; reason: string }[];
}

/**
 * Save a list of sample or patient ids as a stored set. Each id is "<study>:<id>" or a bare id,
 * looked up in every study given; only ids that name a case of a patient-level study are kept,
 * and what did not match is reported, never silently dropped from the count.
 */
export async function createIdSet(principal: string, input: unknown): Promise<IdSetCreated> {
  const b = (input && typeof input === "object" ? input : {}) as { name?: unknown; level?: unknown; studies?: unknown; ids?: unknown };
  const level = b.level === "sample" ? "sample" : b.level === "patient" ? "patient" : null;
  if (!level) throw new Error("level must be 'patient' or 'sample'");
  if (!Array.isArray(b.studies) || !b.studies.length || b.studies.some((s) => typeof s !== "string"))
    throw new Error("studies must name at least one study");
  if (!Array.isArray(b.ids) || !b.ids.length) throw new Error("ids must list at least one id");
  if (b.ids.length > ID_SET_MAX)
    throw new Error("a stored id set holds at most " + ID_SET_MAX.toLocaleString("en-US") + " ids; this list has " + b.ids.length.toLocaleString("en-US"));
  const ids = b.ids.map((x) => String(x ?? "").trim()).filter(Boolean);
  const studies = [...new Set(b.studies as string[])];
  const r = await resolveCaseIds(studies, level, ids);
  const perStudy: Record<string, string[]> = {};
  const unmatchedExamples: string[] = [];
  r.matches.forEach((hits, i) => {
    if (!hits.length && unmatchedExamples.length < 20) unmatchedExamples.push(ids[i]);
    for (const h of hits) (perStudy[h.study] ??= []).push(level === "sample" ? h.sample! : h.patient);
  });
  const duplicates = ids.length - new Set(ids).size;
  const set = await saveIdSet(principal, {
    name: String(b.name ?? ""), level: level as IdSetLevel, perStudy,
    source: { idsIn: ids.length, unmatched: r.unmatched, duplicates, multiStudy: r.multiStudy }
  });
  return { set, unmatched: r.unmatched, unmatchedExamples, duplicates, multiStudy: r.multiStudy, refused: r.refused };
}
