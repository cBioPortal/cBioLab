// View kinds shown as previews: drawn and usable, but not yet held to invariant 12 (no method
// record, no golden test of their statistic). Each entry says what is pending. The view header
// marks these with a Preview badge, and scripts/check-method-scripts.ts exempts them by this list,
// so a kind leaves both the moment its entry is removed. Browser-safe.
export const PREVIEW_KINDS: Record<string, string> = {
  acquired: "no method record or golden test of the before/after pairing and McNemar counts yet",
  ctdna: "no method record or golden test of the agreement counts, Wilson intervals and survival split yet",
  exclusivity: "no method record or golden test of the DISCOVER background fit against the R package yet",
  cutpoint: "no method record or golden test of the maximally selected log-rank scan against R maxstat yet",
  predictive: "no method record or golden test of the per-gene interaction fits yet",
  txendpoints: "no method record or golden test of the endpoint derivation (lines, stops, progression) or the median intervals yet",
  forest: "no method record or golden test of the per-stratum Cox fits and the DerSimonian–Laird pooling yet",
  adjusted: "no method record or golden test of the per-gene logistic fits yet",
  instability: "no method record, and no check of the arm calls and aneuploidy scores against Taylor et al.'s published values yet",
  actionability: "no method record of the per-patient highest-level counts yet",
};

/** what a preview kind still lacks, or null for a kind held to the full checks */
export const previewPending = (kind: unknown): string | null =>
  Object.prototype.hasOwnProperty.call(PREVIEW_KINDS, String(kind)) ? PREVIEW_KINDS[String(kind)] : null;
