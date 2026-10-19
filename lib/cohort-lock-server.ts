// Locking cohorts (lib/cohort-lock.ts): evaluate what each definition selects right now, and keep it
// as stored id sets the cohort then names — its patients, their samples, and each of its split
// arms' patients — with when, and against which data, it was done.
//
// Every cohort asked for is locked at one moment, so an analysis locked as a whole is one snapshot:
// a data load between two cohorts' locks cannot leave them reflecting different data. A cohort
// that is already locked is locked afresh from its definition. Patient-level studies only: a lock
// lists patients.
import { resolveDocCohorts, resolveStudy, studyProfiles } from "./analysis.ts";
import { resolverFor, PatientLevelResolver } from "./federation.ts";
import { cohortStudies } from "./view-coverage.ts";
import { oncokbPin } from "./annotation.ts";
import { saveIdSet } from "./id-set-store.ts";
import { lockDate } from "./cohort-lock.ts";
import type { AnalysisDoc, CohortDef, CohortLock, LockedMembers } from "./types.ts";

export interface Locked {
  at: string;
  dataVersion: string;
  oncokbPin: string | null;
  /** each cohort asked for -> its lock, to write into the document as `cohorts[name].lock` */
  locks: Record<string, CohortLock>;
}

/**
 * Lock `cohorts` of `doc` (every authored cohort when none are named): what each definition, and
 * each of its split arms, selects now, saved as the principal's stored sets.
 */
export async function lockCohorts(principal: string, input: { doc: unknown; cohorts?: unknown },
  /** what the data looks like now (lib/next-cache.ts dataVersion, passed in: that module exists only under Next) */
  dataVersion: () => Promise<string>): Promise<Locked> {
  const src = input.doc as AnalysisDoc;
  if (!src || typeof src !== "object" || !src.cohorts || typeof src.cohorts !== "object") throw new Error("doc must be an analysis document with cohorts");
  const authored = Object.keys(src.cohorts);
  const names = input.cohorts == null ? authored : Array.isArray(input.cohorts) ? input.cohorts.map(String) : null;
  if (!names || !names.length) throw new Error("cohorts must name at least one of the document's cohorts");
  const unknown = names.filter((n) => !authored.includes(n));
  if (unknown.length) throw new Error("no cohort " + unknown.map((n) => "“" + n + "”").join(", ") + " to lock; have " + authored.join(", "));
  // a cohort locked again is locked from its definition, not from its last lock
  const fresh: AnalysisDoc = { ...src, cohorts: Object.fromEntries(Object.entries(src.cohorts).map(([n, d]) => {
    if (!names.includes(n)) return [n, d];
    const { lock: _lock, ...rest } = d as CohortDef;
    return [n, rest];
  })) };
  const { doc, docStudy } = await resolveDocCohorts(fresh);
  const at = new Date().toISOString();
  const [version, pin] = await Promise.all([dataVersion(), process.env.ONCOKB_PIN ? Promise.resolve(process.env.ONCOKB_PIN) : oncokbPin()]);
  const lockOf = (cohort: string) => ({ cohort, at, dataVersion: version, oncokbPin: pin ?? null });

  const resolvers = new Map<string, PatientLevelResolver>();
  const resolver = async (requested: string): Promise<{ study: string; res: PatientLevelResolver }> => {
    const study = await resolveStudy(requested, docStudy);
    let res = resolvers.get(study);
    if (!res) {
      const r = await resolverFor(study, { oncokbPin: pin ?? undefined, ...(await studyProfiles(study)) });
      if (!(r instanceof PatientLevelResolver))
        throw new Error("a lock lists the cohort's patients, and " + r.instance.label + " is not entitled to patient-level data (" + study + ")");
      res = r;
      resolvers.set(study, r);
    }
    return { study, res };
  };
  /** one cohort's or arm's members now, per study: its patients, and their samples when asked */
  const members = async (name: string, withSamples: boolean) => {
    const def = doc.cohorts[name];
    const patients: Record<string, string[]> = {}, samples: Record<string, string[]> = {};
    for (const s of cohortStudies(def, docStudy)) {
      const { study, res } = await resolver(s);
      patients[study] = await res.members(def);
      if (withSamples) samples[study] = await res.memberSamples(def);
    }
    return { patients, samples };
  };
  const size = (m: Record<string, string[]>) => Object.values(m).reduce((n, x) => n + new Set(x).size, 0);

  const locks: Record<string, CohortLock> = {};
  for (const name of names) {
    // ONE stored set per locked cohort: its patients, and as parts their samples and each arm's patients
    const top = await members(name, true);
    const parts: Record<string, Record<string, string[]>> = { samples: top.samples };
    const children: Record<string, LockedMembers> = {};
    // its split arms, at every depth: "<name> / <split> / <arm>[ / <split> / <arm> …]"
    for (const child of Object.keys(doc.cohorts).filter((n) => n.startsWith(name + " / ") && !authored.includes(n))) {
      const rel = child.slice(name.length + 3), part = "arm:" + rel;
      parts[part] = (await members(child, false)).patients;
      children[rel] = { set: "", part, n: size(parts[part]) };
    }
    const set = await saveIdSet(principal, {
      name: name + " — locked " + lockDate(at), level: "patient", perStudy: top.patients, parts,
      source: { idsIn: size(top.patients), unmatched: 0, duplicates: 0, multiStudy: 0, lockOf: lockOf(name) },
    }, { allowEmpty: true });
    for (const c of Object.values(children)) c.set = set.id;
    locks[name] = { set: set.id, n: set.count, nSamples: set.parts?.samples ?? 0, at, dataVersion: version, oncokbPin: pin ?? null,
      ...(Object.keys(children).length ? { children } : {}) };
  }
  return { at, dataVersion: version, oncokbPin: pin ?? null, locks };
}
