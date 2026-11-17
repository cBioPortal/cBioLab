// The sv view's line after its row count, as the portal's Structural Variants tab writes it.

/**
 * ": includes <n> duplicate structural variant(s) in patients with multiple samples", or "" when there
 * are none (ResultsViewStructuralVariantMapper itemsLabelPlural).
 */
export function svDuplicatesNote(n: number): string {
  return n > 0 ? ": includes " + n + " duplicate " + (n === 1 ? "structural variant" : "structural variants") + " in patients with multiple samples" : "";
}
