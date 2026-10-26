// A study's molecular profiles as the study itself describes them (cBioPortal's genetic_profile):
// each profile's alteration type, datatype and name. What a plot axis can do with a profile follows
// from these, never from its name. Browser-safe, so the page's Data picker and the engine read the
// same description.

/** one profile of one study, its id without the study prefix (the derived tables' profile_type) */
export interface ProfileInfo {
  profile: string;
  /** cBioPortal's genetic_alteration_type: MRNA_EXPRESSION, COPY_NUMBER_ALTERATION, GENERIC_ASSAY, … */
  type: string;
  /** cBioPortal's datatype: CONTINUOUS, Z-SCORE, LOG2-VALUE, DISCRETE, MAF, SV, CATEGORICAL, LIMIT-VALUE, … */
  datatype: string;
  name: string;
  /** a generic assay's own kind: METHYLATION, PHOSPHOSITE_QUANTIFICATION, ARMLEVEL_CNA, … */
  assayType?: string;
  /** a generic assay measured once per patient rather than per sample */
  patientLevel?: boolean;
  /** a study holding the profile, which a picker asks for its entities */
  study?: string;
  /** the study's own order among its profiles */
  order: number;
}

/**
 * What an axis does with a profile, from its type and datatype: a mutation (grouped by mutation
 * type, or mutated or not), a structural variant (present or not), a discrete copy-number call
 * (one category per level), a number per case (continuous, z-scores, log2), or, for a generic assay,
 * a number or a category per case for one entity. null: not something a plot axis reads.
 */
export type ProfileUse = "mutation" | "sv" | "discrete" | "number" | "assayNumber" | "assayCategory";
export function profileUse(p: Pick<ProfileInfo, "type" | "datatype">): ProfileUse | null {
  const t = p.type.toUpperCase(), d = p.datatype.toUpperCase();
  if (t === "MUTATION_EXTENDED") return d === "MAF" ? "mutation" : null;
  if (t === "STRUCTURAL_VARIANT") return "sv";
  if (t === "GENERIC_ASSAY") return d === "CATEGORICAL" || d === "BINARY" ? "assayCategory" : "assayNumber";
  if (t === "COPY_NUMBER_ALTERATION" && d === "DISCRETE") return "discrete";
  if (t === "COPY_NUMBER_ALTERATION" || t === "MRNA_EXPRESSION" || t === "PROTEIN_LEVEL" || t === "METHYLATION")
    return d === "CONTINUOUS" || d === "Z-SCORE" || d === "LOG2-VALUE" || d === "LOG-VALUE" ? "number" : null;
  return null;
}

/** the portal's order of data types in its Plots tab */
const TYPE_ORDER = ["MUTATION_EXTENDED", "STRUCTURAL_VARIANT", "COPY_NUMBER_ALTERATION", "MRNA_EXPRESSION", "PROTEIN_LEVEL", "METHYLATION", "GENERIC_ASSAY"];
/** cBioPortal's display names for its alteration types, as its Plots tab shows them */
const TYPE_LABEL: Record<string, string> = {
  MUTATION_EXTENDED: "Mutation", STRUCTURAL_VARIANT: "Structural variant", COPY_NUMBER_ALTERATION: "Copy number",
  MRNA_EXPRESSION: "mRNA", PROTEIN_LEVEL: "Protein level", METHYLATION: "DNA methylation",
};
/** cBioPortal's display names for the generic-assay kinds it knows; any other is shown as written */
const ASSAY_LABEL: Record<string, string> = {
  METHYLATION: "DNA methylation", PHOSPHOSITE_QUANTIFICATION: "Phosphosite quantification", ARMLEVEL_CNA: "Arm-level copy number",
  TREATMENT_RESPONSE: "Treatment response", MUTATIONAL_SIGNATURE: "Mutational signature", GENETIC_ANCESTRY: "Genetic ancestry",
};

/** the Data picker's group a profile sits under */
export function profileGroup(p: Pick<ProfileInfo, "type" | "assayType">): string {
  if (p.type === "GENERIC_ASSAY") return ASSAY_LABEL[p.assayType || ""] || (p.assayType || "Generic assay").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return TYPE_LABEL[p.type] || p.type;
}

/** the profiles a plot axis can read, in the portal's order: by type, then the study's own order */
export function plottableProfiles(ps: ProfileInfo[]): ProfileInfo[] {
  const rank = (p: ProfileInfo) => { const i = TYPE_ORDER.indexOf(p.type); return i < 0 ? TYPE_ORDER.length : i; };
  return ps.filter((p) => profileUse(p)).sort((a, b) => rank(a) - rank(b) ||
    profileGroup(a).localeCompare(profileGroup(b)) || a.order - b.order || a.name.localeCompare(b.name));
}
