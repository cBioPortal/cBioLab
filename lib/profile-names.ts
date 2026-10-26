// Short display names for molecular profile types (shared by server engine and
// client UI — keep this module dependency-free so both can import it).
export function shortProfileName(pt: string): string {
  const p = String(pt).toLowerCase();
  if (p === "vaf") return "VAF";
  if (/protein|rppa|mass_spec|abundance/.test(p)) return /zscore/.test(p) ? "prot-z" : "prot";
  if (/methyl/.test(p)) return "meth";
  if (/mrna|rna_seq/.test(p)) return /zscore/.test(p) ? "mRNA-z" : "mRNA";
  if (/log2cna|gistic|\bcna\b|linear_cna/.test(p)) return "CNA";
  return String(pt).slice(0, 10);
}

// A heatmap track's label — this is also its sort key, so engine and UI must
// derive it identically.
export function heatmapTrackLabel(gene: string, profileType: string): string {
  return gene + " " + shortProfileName(profileType);
}

/**
 * A generic-assay entity's id without the words it repeats from its profile's:
 * "mutational_signature_contribution_SBS4" of mutational_signatures_contribution_SBS is "SBS4".
 * A leading word is dropped while the profile's id has it (a plural "s" aside), never the last.
 */
export function entityShortName(entity: string, profileType: string): string {
  const words = new Set(String(profileType).toLowerCase().split("_").flatMap((w) => [w, w.replace(/s$/, "")]));
  const parts = String(entity).split("_");
  let i = 0;
  while (i < parts.length - 1 && words.has(parts[i].toLowerCase())) i++;
  return parts.slice(i).join("_");
}

/** A generic-assay heatmap track's label, and so its sort key: the entity, short, and the profile */
export function assayTrackLabel(entity: string, profileType: string): string {
  const p = String(profileType).toLowerCase();
  const kind = /signature/.test(p) ? "sig" : /armlevel/.test(p) ? "arm" : /methyl/.test(p) ? "meth" : /phospho/.test(p) ? "phos"
    : /ancestry/.test(p) ? "ancestry" : /treatment|response|ic50|auc/.test(p) ? "drug" : shortProfileName(profileType);
  return entityShortName(entity, profileType) + " " + kind;
}

/** the track naming each column's study when an oncoprint spans several, by the portal's name for it */
export const STUDY_TRACK = "Study of origin";

/**
 * The alteration types an oncoprint can say a column was profiled for, in mask-bit order, and
 * the track that says it — the portal's "Profiled for <type>" (its AlterationTypeText words).
 */
export const PROFILED_TYPES = [
  ["MUTATION_EXTENDED", "mutations"], ["COPY_NUMBER_ALTERATION", "copy number alterations"],
  ["STRUCTURAL_VARIANT", "structural variants"], ["MRNA_EXPRESSION", "mRNA expression"], ["PROTEIN_LEVEL", "protein expression"]
] as const;
export type ProfiledType = typeof PROFILED_TYPES[number][0];
export function profiledTrackLabel(type: ProfiledType): string {
  return "Profiled for " + PROFILED_TYPES.find(([t]) => t === type)![1];
}

/** the per-patient sample count row, shown when some patient has more than one: the portal's name */
export const SAMPLES_TRACK = "# Samples per Patient";
