// A gene chart's states (Explore's "KRAS: somatic mutations" and "KRAS: copy-number alterations")
// and the cohort clauses that select them. Shared by the page and the live check that compares what
// a state counts with what its click selects (scripts/check-gene-facets.ts); no server imports.

/**
 * `profileType` of a genomicData leaf naming the study's discrete copy-number profile, whatever
 * its stable id (`cna` in some studies, `gistic` in others), so one clause reads every study's.
 */
export const DISCRETE_CNA_PROFILE = "CNA";

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
    const level = (vals: number[]) => ({ kind: "genomicData", gene, profileType: DISCRETE_CNA_PROFILE, values: vals.map(String) });
    const picked = CNA_LEVELS.filter((l) => states.includes(l.state)).map((l) => l.value);
    if (!states.includes("notProfiled")) return picked.length ? { clauses: [level(picked)] } : { why: "no state is checked" };
    const rest = CNA_LEVELS.filter((l) => !states.includes(l.state)).map((l) => l.value);
    if (!rest.length) return { why: "every state is checked, which is no filter" };
    return { clauses: [{ not: level(rest) }] };
  }
  const prof = { kind: "profiled", type, gene };
  const oql = (calls: string) => ({ kind: "oql", q: gene + ": " + (drivers ? calls.split(" ").map((c) => c + "_DRIVER").join(" ") : calls) });
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
