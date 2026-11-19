// A gene chart's states (Explore's "KRAS: somatic mutations" and "KRAS: copy-number alterations")
// and the cohort clauses that select them. Shared by the page and the live check that compares what
// a state counts with what its click selects (scripts/check-gene-facets.ts); no server imports.

import { ASSAY_VALUES_LIMIT, limitRefusal } from "./filter-limits.ts";

/**
 * `profileType` of a genomicData leaf naming the study's discrete copy-number profile, whatever
 * its stable id (`cna` in some studies, `gistic` in others), so one clause reads every study's.
 */
export const DISCRETE_CNA_PROFILE = "CNA";

/**
 * `profileType` of a genomicData leaf whose `values` are mutation types ("Missense_Mutation"): the
 * samples with a mutation of the gene of any of those types, as the portal's Mutation Type Counts
 * table selects them (`mutationDataFilters`, categorization MUTATION_TYPE).
 */
export const MUTATION_TYPE_PROFILE = "MUTATION_TYPE";

/** a mutation type as the portal's table labels it: "In_Frame_Ins" → "In Frame Ins" */
export function mutationTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

/**
 * The levels of a discrete copy-number call, as cBioPortal's gene CNA chart names them
 * (`/api/genomic-data-counts/fetch`), highest first. A sample with no value in the profile is
 * "Not profiled" (the portal's NA).
 */
export const CNA_LEVELS = [
  { state: "amp", value: 2, label: "Amplified" },
  { state: "gain", value: 1, label: "Gained" },
  { state: "diploid", value: 0, label: "Diploid" },
  { state: "hetloss", value: -1, label: "Heterozygously deleted" },
  { state: "del", value: -2, label: "Homozygously deleted" }
] as const;

export type CnaLevelState = (typeof CNA_LEVELS)[number]["state"];

/** a stored discrete call's label ("1" → "Gained"); the value itself when it is not a level */
export function cnaLevelLabel(value: string | number): string {
  return CNA_LEVELS.find((l) => String(l.value) === String(value))?.label ?? String(value);
}

type GeneType = "MUTATION" | "CNA";

/**
 * OQL alterations as driver calls (MUT_DRIVER, AMP_DRIVER…): what the charts' clicks select when they
 * count OncoKB drivers only, so a click selects exactly the samples its number counts.
 */
export function driverOql(calls: string): string {
  return calls.split(" ").map((c) => c + "_DRIVER").join(" ");
}

/**
 * The clauses that select any of several states of one gene's chart, or why that cannot be one
 * filter. `drivers`: the chart counts OncoKB driver calls only (its states are then altered / amp /
 * del / unaltered / notProfiled, read from the driver-annotated events).
 *
 * Copy number, every alteration: the levels are values of the discrete profile, so any set of
 * them is one `genomicData` clause, and a set with "Not profiled" is the complement of the
 * levels left unchecked.
 */
export function geneStatesClauses(gene: string, type: GeneType, states: string[], drivers: boolean): { clauses: unknown[] } | { why: string } {
  if (type === "CNA" && !drivers) {
    // ifHeld: over several studies, one without the profile has none of these samples rather than refusing
    const level = (vals: number[]) => ({ kind: "genomicData", gene, profileType: DISCRETE_CNA_PROFILE, values: vals.map(String), ifHeld: true });
    const picked = CNA_LEVELS.filter((l) => states.includes(l.state)).map((l) => l.value);
    if (!states.includes("notProfiled")) return picked.length ? { clauses: [level(picked)] } : { why: "no state is checked" };
    const rest = CNA_LEVELS.filter((l) => !states.includes(l.state)).map((l) => l.value);
    if (!rest.length) return { why: "every state is checked, which is no filter" };
    return { clauses: [{ not: level(rest) }] };
  }
  const prof = { kind: "profiled", type, gene };
  const oql = (calls: string) => ({ kind: "oql", q: gene + ": " + (drivers ? driverOql(calls) : calls) });
  const calls: Record<string, string> = type === "CNA" ? { amp: "AMP", del: "HOMDEL" } : { altered: "MUT" };
  if (states.length === 1) {
    const s = states[0];
    if (s === "notProfiled") return { clauses: [{ not: prof }] };
    if (calls[s]) return { clauses: [prof, oql(calls[s])] };
    return { clauses: [prof, { not: oql(Object.values(calls).join(" ")) }] };
  }
  const picked = Object.keys(calls).filter((s) => states.includes(s)).map((s) => calls[s]);
  const rest = Object.keys(calls).filter((s) => !states.includes(s)).map((s) => calls[s]);
  const unaltered = states.includes("unaltered");
  // the profiled part: every profiled state is no narrowing; with unaltered, "none of the rest"
  const within = unaltered ? (rest.length ? { not: oql(rest.join(" ")) } : null) : oql(picked.join(" "));
  if (!states.includes("notProfiled")) return { clauses: within ? [prof, within] : [prof] };
  if (!within) return { why: "every state is checked, which is no filter" };
  return { why: "\"Not profiled\" with another state is not one filter — apply them separately" };
}

/**
 * The clause a gene's Mutation Type Counts table adds for the checked types (STS-OT-3), or why it
 * cannot: the samples with a mutation of the gene of any of them. Each application is one more
 * clause, as the portal appends a `mutationDataFilters` entry.
 */
export function mutationTypesClause(gene: string, types: string[]): { clauses: unknown[] } | { why: string } {
  if (!types.length) return { why: "no mutation type is checked" };
  const refusal = limitRefusal(types.length, ASSAY_VALUES_LIMIT, "mutation types");
  if (refusal) return { why: refusal };
  // ifHeld: over several studies, one with no mutation of a type has none of its samples rather than refusing
  return { clauses: [{ kind: "genomicData", gene, profileType: MUTATION_TYPE_PROFILE, values: types, ifHeld: true }] };
}

/** is this leaf a filter of `gene`'s mutation-type table (a genomicData leaf on its mutation types)? */
export function isMutationTypeLeafFor(leaf: unknown, gene: string): boolean {
  const l = leaf as { kind?: string; gene?: string; profileType?: string } | null | undefined;
  return !!l && l.kind === "genomicData" && l.profileType === MUTATION_TYPE_PROFILE && String(l.gene || "").toUpperCase() === gene;
}

/**
 * The mutation types a draft's top-level clauses filter `gene` on, for the table's applied rows; a
 * negated one ("none of these types") is not a row the table can check, so it is counted in `excluded`.
 */
export function appliedMutationTypes(def: { all?: unknown[] } | null | undefined, gene: string): { types: string[]; excluded: number } {
  const out = new Set<string>();
  let excluded = 0;
  for (const c of def?.all || []) {
    if (isMutationTypeLeafFor(c, gene)) for (const v of (c as { values?: unknown[] }).values || []) out.add(String(v));
    else if (isMutationTypeLeafFor((c as { not?: unknown } | null)?.not, gene)) excluded++;
  }
  return { types: [...out], excluded };
}
