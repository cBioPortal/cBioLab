// View kinds cBioPortal has no counterpart for. The Examples tab and the add-view buttons mark
// them NEW. A kind the portal draws in some form (its Comparison, Plots, Mutations, Pathways or
// patient-view tabs) is left out, even where this one goes further. Browser-safe.
const NEW_KINDS = new Set([
  "cox", "logistic", "riskmodel", "txendpoints", "multistate", "rmst", "predictive", "cutpoint", "forest", "hla",
  "course", "sequence", "incidence", "labs", "attrition",
  "adjusted", "actionability", "drivernegative", "exclusivity", "organotropism", "molsubtype", "germline",
  "paired", "acquired", "ctdna", "clonality", "genome", "instability", "composition",
]);

export const isNewKind = (kind: unknown): boolean => NEW_KINDS.has(String(kind));

/** the mark's hover text */
export const NEW_TITLE = "not in cBioPortal";
