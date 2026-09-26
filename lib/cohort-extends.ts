import type { AnalysisDoc, CohortDef } from "./types.ts";

/**
 * Resolves every cohort's `extends` into a flat `all` array before anything else touches the
 * document — the same "resolve once, everything downstream sees an ordinary document" shape as
 * lib/params.ts's template resolution. A cohort that extends another gets the parent's `all`
 * clauses spliced in AHEAD of its own; extends only ever combines `all` — study/studies/lineGap/
 * notes stay the child's own, never inherited. A cycle (direct, or through a chain of extends)
 * is rejected loudly, naming the chain, rather than looping or silently picking a side.
 *
 * The v1 bare event shorthand (`a`+`rel`, no `all`) is refused on either side of an `extends`
 * relationship rather than guessed at — that shape only ever means one implicit leaf, and
 * splicing clause arrays around it has no sensible reading.
 */
export function resolveExtends(doc: AnalysisDoc): AnalysisDoc {
  const cohorts = doc.cohorts || {};
  if (!Object.values(cohorts).some((d) => d && d.extends)) return doc; // fast path: nothing to do

  const isBareSugar = (d: CohortDef) => !!(d.a && d.rel && !d.all);
  const resolved: Record<string, CohortDef> = {};

  function resolveOne(name: string, chain: string[]): CohortDef {
    if (resolved[name]) return resolved[name];
    const def = cohorts[name];
    if (!def) throw new Error("cohort \"" + name + "\" is not defined");
    if (!def.extends) { resolved[name] = def; return def; }
    if (chain.includes(name))
      throw new Error("cohort \"" + name + "\" extends a cycle: " + [...chain, name].join(" -> "));
    const parentDef = cohorts[def.extends];
    if (!parentDef)
      throw new Error("cohort \"" + name + "\" extends unknown cohort \"" + def.extends + "\"");
    if (isBareSugar(def) || isBareSugar(parentDef))
      throw new Error("cohort \"" + name + "\": extends only combines array-based cohorts (all: [...]), not the shorthand event form");
    const parent = resolveOne(def.extends, [...chain, name]);
    const merged: CohortDef = { ...def, all: [...(parent.all || []), ...(def.all || [])] };
    delete merged.extends; // fully spliced — nothing downstream needs to know it was inherited
    resolved[name] = merged;
    return merged;
  }

  const out: Record<string, CohortDef> = {};
  for (const name of Object.keys(cohorts)) out[name] = resolveOne(name, []);
  return { ...doc, cohorts: out };
}
