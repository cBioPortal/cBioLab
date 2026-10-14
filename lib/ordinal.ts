// Values that have an order of their own — stage, grade, a Gleason score, a T/N/M category — read
// in that order, not by how many cases hold each: "1A, 1B, 2A, … 4" rather than "4, 1A, 4A, 1".
// Browser-safe; Explore's facets use it.

/** values that say a value is missing, which sort after every real one */
const MISSING = /^(unknown|unk|na|n\/a|not applicable|not available|not reported|none|no value entered|\[not available\]|\[unknown\]|indeterminate|other|x|[tnmg]x)$/i;

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

/**
 * A value read as a position: an optional word ("Stage", "Grade", "pT", "N" …), a number or a
 * roman numeral, an optional letter or two ("A", "B1"), and optionally a range ("1-3"). Null for
 * anything else.
 */
export function ordinalKey(v: string): [number, string] | null {
  const m = /^\s*(?:(?:stage|grade|gleason|group|score|level|class|p|c|y|yp)\s*)?(?:[tnmg](?=\s*(?:\d|is|i)))?\s*(\d+(?:\.\d+)?|iv|v|i{1,3}|is)\s*([a-d]?\d?)\s*(?:[-–]\s*\d+[a-d]?)?\s*$/i.exec(v);
  if (!m) return null;
  const head = m[1].toUpperCase();
  const n = head === "IS" ? 0 : ROMAN[head] ?? Number(head);
  return Number.isFinite(n) ? [n, m[2].toUpperCase()] : null;
}

/**
 * `values` in their natural order when they read as positions; otherwise unchanged. A list counts
 * as ordered when at least three values, and all but a few (two, or a tenth), read as positions:
 * registries mix codes like "Occu" or "OC" (occult) into a stage list. Those, and the "missing"
 * ones, follow the ordered values in their given order.
 */
export function naturalOrder<T>(values: T[], name: (v: T) => string): T[] {
  const keyed: [T, [number, string]][] = [], rest: T[] = [];
  for (const v of values) {
    const k = MISSING.test(name(v).trim()) ? null : ordinalKey(name(v));
    if (k) keyed.push([v, k]); else rest.push(v);
  }
  const odd = rest.filter((v) => !MISSING.test(name(v).trim())).length;
  if (keyed.length < 3 && !(keyed.length >= 2 && odd === 0)) return values;
  if (odd > Math.max(2, Math.floor(values.length / 10))) return values;
  keyed.sort(([, [na, sa]], [, [nb, sb]]) => na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0));
  return [...keyed.map(([v]) => v), ...rest];
}
