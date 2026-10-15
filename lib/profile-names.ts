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
