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
