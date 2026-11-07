// A signature's COSMIC reference profile (COSMIC v3.3, GRCh37 — the release and build the portal's
// chart reads), lined up with a sample's spectrum channels. Server-side: the vendored profiles
// (./cosmic-reference.ts) stay out of the browser bundle; the result carries the one drawn.
import { COSMIC_REFERENCE } from "./cosmic-reference.ts";

export const REFERENCE_SOURCE = "COSMIC v3.3 (GRCh37)";

/** the reference profile a signature row names: the first word of its name, as the portal looks it up (SBS5, DBS2, ID1) */
export const referenceKey = (name: string) => name.split(" ")[0];

/** a spectrum channel's name in the reference file: A[C>A]A → A_C-A_A, AC>CA → AC-CA, ID names unchanged */
export function referenceChannel(label: string): string {
  return label.replace(/[[\]]/g, "_").replace(/>/g, "-");
}

const table = (version: string) => (COSMIC_REFERENCE as Record<string, Record<string, Record<string, number>> | undefined>)[version];

/** the names of the signatures among `names` that have a reference profile for `version` */
export function referenced(version: string, names: string[]): string[] {
  const t = table(version);
  return t ? names.filter((n) => Object.hasOwn(t, referenceKey(n))) : [];
}

/**
 * The reference profile of signature `name` as a percent per channel, in the order of `channels`, or
 * the reason there is none: a type the reference does not cover, a signature it does not hold, or a
 * channel of the spectrum it lacks.
 */
export function referenceProfile(version: string, name: string, channels: string[]): { key: string; values: number[] } | string {
  const t = table(version);
  if (!t) return REFERENCE_SOURCE + " has reference profiles for SBS, DBS and ID signatures only, not " + version;
  const key = referenceKey(name);
  const prof = Object.hasOwn(t, key) ? t[key] : undefined;
  if (!prof) return REFERENCE_SOURCE + " has no reference profile named " + key;
  const missing = channels.filter((c) => !Object.hasOwn(prof, referenceChannel(c)));
  if (missing.length) return REFERENCE_SOURCE + "'s " + key + " has no value for " + missing.slice(0, 5).join(", ") + (missing.length > 5 ? " and " + (missing.length - 5) + " more channels" : "");
  return { key, values: channels.map((c) => 100 * prof[referenceChannel(c)]) };
}
