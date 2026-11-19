// How much one filter clause holds, read by the cohort compiler (lib/cohort2.ts) and by the page that
// builds the clause, so a selection past a limit is refused by name before it is applied rather than
// cut short or rejected after. No server imports.

/** an `any` clause's leaves: its alternatives */
export const ANY_LEAF_LIMIT = 8;
/** the values one clinical clause lists */
export const CLINICAL_VALUES_LIMIT = 50;
/** the values one genomic-data or generic-assay clause lists */
export const ASSAY_VALUES_LIMIT = 20;

/** why `n` checked rows cannot be one filter of at most `limit` `what`, or null when they can */
export function limitRefusal(n: number, limit: number, what: string): string | null {
  return n > limit ? "one filter holds at most " + limit + " " + what + "; " + n + " are checked" : null;
}
