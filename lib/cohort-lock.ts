// Locked cohorts: a cohort frozen to the samples its definition selected at one moment, so an
// analysis stops drifting as samples are added to the data.
//
// A locked cohort keeps its definition (`all`, the record of how it was made) and gains a `lock`:
// the stored id set of its samples then (lib/id-set-store.ts), when, against
// which data version and OncoKB release — and the frozen membership of each of its split arms,
// keyed by the arm's name under the cohort ("<split> / <arm>"). The engine evaluates the set, not
// the definition; the definition is still run, beside it, to say how far the data has moved since.
//
// `applyLocks` rewrites a document whose splits are expanded (lib/cohort-partitions.ts) but whose
// `extends` is not yet resolved: a locked cohort, and each locked arm, becomes its set alone. An arm
// added after the lock still `extends` its parent, so it is evaluated inside the frozen parent and
// the parent's arms still add up to it. Run before `extends` resolves, in every pipeline that reads
// a document's cohorts (runAnalysis, resolveDocCohorts), so no reader sees the live definition by
// mistake. Pure and browser-safe.
import type { AnalysisDoc, CohortDef, CohortLock, LockedMembers } from "./types.ts";

/** The clause a locked cohort or arm compiles to: its samples when it was locked. */
export function lockClause(m: LockedMembers): { kind: "sampleList"; set: string; part?: string } {
  return { kind: "sampleList", set: m.set, ...(m.part ? { part: m.part } : {}) };
}

/** What a locked name is evaluated from, and what its definition still says. */
export interface AppliedLock {
  /** the cohort that holds the lock: the name itself, or the cohort a split arm belongs to */
  cohort: string;
  lock: CohortLock;
  members: LockedMembers;
}

/**
 * Every locked cohort and arm in an expanded document, made its frozen set; and the document as
 * it would be without the locks, which says what the definitions select now.
 */
export function applyLocks(doc: AnalysisDoc): { doc: AnalysisDoc; live: AnalysisDoc; locked: Record<string, AppliedLock> } {
  const cohorts = doc.cohorts || {};
  const holders = Object.entries(cohorts).filter(([, d]) => d && d.lock);
  if (!holders.length) return { doc, live: doc, locked: {} };
  const locked: Record<string, AppliedLock> = {};
  for (const [cohort, d] of holders) {
    const lock = validLock(d.lock, cohort);
    locked[cohort] = { cohort, lock, members: lock };
    for (const [rel, m] of Object.entries(lock.children || {})) {
      const name = cohort + " / " + rel;
      // an arm that no longer exists (its split was edited away) has nothing to freeze
      if (cohorts[name]) locked[name] = { cohort, lock, members: validMembers(m, name) };
    }
  }
  const out: Record<string, CohortDef> = {};
  const live: Record<string, CohortDef> = {};
  for (const [name, def] of Object.entries(cohorts)) {
    const { lock: _lock, ...unlocked } = def;
    live[name] = unlocked;
    const l = locked[name];
    if (!l) { out[name] = def; continue; }
    const { extends: _ext, ...rest } = unlocked;
    out[name] = { ...rest, all: [lockClause(l.members)] };
  }
  return { doc: { ...doc, cohorts: out }, live: { ...doc, cohorts: live }, locked };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validMembers(m: unknown, name: string): LockedMembers {
  const x = (m && typeof m === "object" ? m : {}) as Partial<LockedMembers>;
  if (typeof x.set !== "string" || !UUID.test(x.set)) throw new Error("cohort “" + name + "” is locked, but its lock names no stored set of patients");
  if (!Number.isInteger(x.n) || (x.n as number) < 0) throw new Error("cohort “" + name + "” is locked, but its lock does not say how many patients it froze");
  if (x.part !== undefined && (typeof x.part !== "string" || !x.part)) throw new Error("cohort “" + name + "” is locked, but its lock names a part that is not a name");
  return x as LockedMembers;
}

function validLock(l: unknown, name: string): CohortLock {
  const x = validMembers(l, name) as CohortLock;
  if (typeof x.at !== "string" || Number.isNaN(Date.parse(x.at))) throw new Error("cohort “" + name + "” is locked, but its lock does not say when");
  return x;
}

/** "18 Oct 2026", the way a lock is named on the page and in a readback. */
export function lockDate(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
