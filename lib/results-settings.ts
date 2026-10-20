// The Results page's deployment settings, read in the browser through the public environment
// (lib/public-env.ts): how many studies one gene query may cover, and when expression data may be
// compared across studies. Browser-safe and pure.

/** RESULTS_MAX_STUDIES unset: the most studies one gene query covers */
export const RESULTS_MAX_STUDIES_DEFAULT = 50;

/** RESULTS_MAX_STUDIES, a positive whole number; anything else is the default */
export function resultsMaxStudies(env: Record<string, string | undefined>): number {
  const n = Number(env.RESULTS_MAX_STUDIES);
  return Number.isInteger(n) && n > 0 ? n : RESULTS_MAX_STUDIES_DEFAULT;
}

/**
 * When expression data may be compared across studies — cBioPortal's `enable_cross_study_expression`:
 * "all", "none", or "pancan" (every study a TCGA PanCancer Atlas study, whose expression is
 * normalised together; the rule cbioportal.org runs, and the default here).
 */
export type CrossStudyExpression = "all" | "none" | "pancan";

export function crossStudyExpression(env: Record<string, string | undefined>): CrossStudyExpression {
  const v = String(env.CROSS_STUDY_EXPRESSION || "").trim().toLowerCase();
  return v === "all" || v === "none" ? v : "pancan";
}

/** whether expression may be compared across these studies; one study always may */
export function expressionAcross(studies: string[], rule: CrossStudyExpression): boolean {
  if (studies.length <= 1 || rule === "all") return true;
  if (rule === "none") return false;
  return studies.every((s) => /pan_can_atlas/.test(s));
}

/** a profile that measures expression (mRNA, microRNA, protein), which the rule above governs */
export const isExpressionProfile = (profile: string): boolean => /mrna|rna_seq|mirna|microrna|rppa|protein/i.test(profile);

/** the same, for a profile as its study describes it (lib/profile-catalog.ts): cBioPortal's own list */
export const isExpressionType = (type: string): boolean =>
  ["MRNA_EXPRESSION", "MICRO_RNA_EXPRESSION", "RNA_EXPRESSION", "PROTEIN_LEVEL"].includes(type.toUpperCase());
