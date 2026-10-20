// The categories an alteration plot axis takes, and its limits. Browser-safe, so the method panel
// names an OQL covariate's reference level the way the engine chose it, and the axis's gene dialog
// holds the reader to the limits the engine enforces.
export const OQL_ALTERED = "Altered";
export const OQL_UNALTERED = "Unaltered";
/** a case not profiled for a statement it did not match: not altered as far as anyone knows, but never "Unaltered" */
export const OQL_NOT_PROFILED = "Not profiled";
/** one group per statement: a case matching three or more statements */
export const OQL_SEVERAL = "3 or more lines";
/** one group per statement: at most this many statements, so the groups (and their pairs) stay readable */
export const OQL_STATEMENT_CAP = 6;
/** a gene-set alteration axis takes at most this many genes */
export const ALTERATION_GENE_SET_CAP = 20;
