// Canonical names for timeline events (`clinical_event.event_type`) and their
// attribute keys. Shared by the server engine and the client UI — keep this
// module dependency-free so both can import it, and never fork the logic
// (same rule as lib/profile-names.ts).
//
// WHY THIS EXISTS, and why it does so little.
//
// Study curators spell the same concept differently: `Treatment` appears in 87
// studies and `TREATMENT` in 10; `Sample acquisition`, `Sample Acquisition` and
// `SAMPLE ACQUISITION` are three spellings of one thing; even the attribute key
// is written both `TREATMENT_TYPE` and `Treatment_TYPE`. A chart that treats
// those as different event types silently splits a cohort in half.
//
// Measured against the live database, case-folding alone is *sufficient* for
// the names this engine keys off:
//
//            distinct   case-folded   merges   residual separator-only pairs
//   event_type     38            25       13                            0
//   attribute keys 240          231        9                            0
//   attr. values   212          193       19                            5
//
// Zero residual collisions for event types and keys means no pair of names
// differs only by a separator, space or punctuation — so case-folding catches
// every duplicate that normalization can detect at all, and there is nothing
// left for a cleverer rule to find.
//
// Whitespace is trimmed too, because values like "xrt" and "xrt " differ by a
// data-entry artifact rather than a naming convention.
//
// NOTHING BEYOND CASE AND TRIM. The next rule up — folding hyphens, commas or
// internal spaces — would merge `beta blocker` with `beta-blocker` (fine) and
// is one short step from deciding `Targeted Therapy` and `Targeted Molecular
// Therapy` name the same class (they do not: one is a category, the other a
// member of it). Where two spellings survive, they stay visible and the reader
// decides. Guessing here does not crash anything; it draws a believable, wrong
// chart, which is worse.
//
// This is a GROUPING AND DISPLAY concept, not a query rewrite. The database
// stores the variants as distinct literals, so SQL matching a canonical name
// must match every variant: every timeline match — event type, attribute key,
// attribute value — goes through `foldedEqualsSql` / `foldedInSql` below, which
// fold the column and the literal with the same SQL function.

/** The grouping key for an event type or attribute key. Case + whitespace only. */
export function canonicalEventName(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * The grouping key for a CLINICAL ATTRIBUTE VALUE — `RACE`, `GENDER`,
 * `METASTATIC_SITE`. Delegates rather than restating the rule, because it is
 * the same rule for the same reason, and two copies would drift.
 *
 * The measurement in the table above covers these too: 212 distinct values fold
 * to 193, merging 19 real duplicates with 5 residual separator-only pairs left
 * deliberately visible.
 *
 * This one is not merely cosmetic. A facet click compiles to an equality on the
 * value, so before folding, clicking `Female` in `breast_msk_2025` selected
 * 1,097 patients and silently left behind the 1,987 recorded as `FEMALE` — a
 * cohort 35.6% short, with every downstream survival curve and gene frequency
 * computed on it. See clinicalValueFoldSql.
 */
export function canonicalClinicalValue(raw: string): string {
  return canonicalEventName(raw);
}

/**
 * The SQL that folds a clinical value to its grouping key.
 *
 * ONE expression, used by the facet query that counts the values AND by the
 * cohort predicate that selects them. That shared use is the whole point: if
 * the chart grouped by a folded key while the predicate matched a raw literal,
 * the label would look right and select a subset of what it counted — strictly
 * worse than not folding at all, because the error stops being visible.
 *
 * Both sides are folded IN SQL, never one side in JavaScript. ClickHouse
 * `lower` is ASCII-only and JS `toLowerCase` is Unicode-aware, so a value like
 * `MÜNCHEN` would fold two different ways and the predicate would match
 * nothing. Folding the column and the literal with the same function makes that
 * class of bug unrepresentable; `lowerUTF8`/`trimBoth` are named explicitly for
 * the same reason.
 */
export function clinicalValueFoldSql(expr: string): string {
  return "lowerUTF8(trimBoth(" + expr + "))";
}

/** the folded spellings cBioPortal's study view reads as "no value recorded" (its isAttributeValueNA): empty, NA, N/A, NaN */
export const CLINICAL_MISSING_VALUES: readonly string[] = ["", "na", "n/a", "nan"];

/** true when a clinical value is recorded: not one of CLINICAL_MISSING_VALUES, folded as clinicalValueFoldSql folds */
export function clinicalRecordedSql(expr: string): string {
  return clinicalValueFoldSql(expr) + " NOT IN (" + CLINICAL_MISSING_VALUES.map((v) => "'" + v + "'").join(", ") + ")";
}

/** One canonical event name and the spellings that folded into it. */
export interface FoldedName {
  /** the grouping key — lowercase, trimmed */
  canonical: string;
  /** what to show a human: the most frequent original spelling */
  label: string;
  /** every original spelling seen, most frequent first; length > 1 means a fold happened */
  variants: string[];
  /** summed weight across the variants (patients, events — the caller decides) */
  n: number;
}

/**
 * Group raw spellings under their canonical form, keeping the variants so the
 * fold can be disclosed rather than hidden. The display label is the most
 * frequent spelling, so a chart says "Treatment", not "treatment".
 */
export function foldEventNames(rows: { name: string; n: number }[]): FoldedName[] {
  const by = new Map<string, { name: string; n: number }[]>();
  for (const r of rows) {
    const c = canonicalEventName(r.name);
    if (!c) continue;
    const list = by.get(c);
    if (list) list.push(r); else by.set(c, [r]);
  }
  return [...by.entries()]
    .map(([canonical, list]) => {
      const sorted = [...list].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      return {
        canonical,
        label: sorted[0].name,
        variants: sorted.map((x) => x.name),
        n: sorted.reduce((t, x) => t + x.n, 0)
      };
    })
    .sort((a, b) => b.n - a.n || a.canonical.localeCompare(b.canonical));
}

/** Does this canonical event name record a therapy? The one heuristic behind every "which event is treatment" default. */
export function isTreatmentEventName(canonical: string): boolean {
  return /treat|therap|regimen|drug|medicat/.test(canonical);
}

/** The most frequent treatment-like event among folded names, or null when there is none. */
export function treatmentEventOf<T extends { canonical: string }>(folded: T[]): T | null {
  return folded.find((f) => isTreatmentEventName(f.canonical)) || null;
}

/**
 * Human-readable note naming the spellings folded together, or "" when nothing
 * folded. Goes into the caveat so a reader can see the merge and undo it
 * mentally — the difference between this and a silent harmonization.
 */
export function foldNote(folded: FoldedName[]): string {
  const merged = folded.filter((f) => f.variants.length > 1);
  if (!merged.length) return "";
  return "Event names differing only in case were treated as one: " +
    merged.map((f) => f.variants.join(" = ")).join("; ") +
    ". No other spelling differences were merged.";
}

/**
 * The SQL that folds a timeline name — an event type, an attribute key or an attribute value —
 * to its grouping key. The same rule and the same function as clinicalValueFoldSql, for the same
 * reason: both sides of a comparison must fold in SQL, or `lower` (ASCII) and JavaScript's
 * `toLowerCase` (Unicode) disagree and the predicate silently matches nothing.
 */
export function nameFoldSql(expr: string): string {
  return clinicalValueFoldSql(expr);
}

const sqLit = (s: string) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

/** `col` matches `literal` up to case and surrounding whitespace, folded on both sides in SQL. */
export function foldedEqualsSql(col: string, literal: string): string {
  return nameFoldSql(col) + " = " + nameFoldSql(sqLit(literal));
}

/** `col` matches any of `literals` up to case and surrounding whitespace. */
export function foldedInSql(col: string, literals: string[]): string {
  return nameFoldSql(col) + " IN (" + literals.map((l) => nameFoldSql(sqLit(l))).join(", ") + ")";
}
