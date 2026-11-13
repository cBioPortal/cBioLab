/**
 * Explore's filters in its URL (the Study View's STV-URL-2, STV-URL-3, STV-BM-1).
 *
 * The page writes its filters as `filters=<url-json of the clauses>` (lib/url-json.ts), so a reload,
 * Back, Copy link and a stored link all carry them (docs/LINKS.md). It also reads the forms a
 * cbioportal.org link uses, translated to clauses:
 *   - `filters=` / `#filterJson=`: a StudyViewFilter as JSON (its `clinicalDataFilters` and `studyIds`);
 *   - `filterAttributeId=` + `filterValues=`: one attribute's values, `a-b` ranges for a number.
 * Anything the translation can't express is refused by name, never dropped silently.
 */
import type { Clause, ClinicalLeaf } from "./types.ts";
import { encodeUrlJson, readUrlJson } from "./url-json.ts";

/** the page's own parameter */
export const FILTERS_PARAM = "filters";

/** a cohort's `any` holds at most this many leaves (lib/cohort2.ts) */
const ANY_LIMIT = 8;

export type UrlFilters = { all: Clause[]; studies?: string[]; refused?: string[] };

/** the clauses as the page writes them; null for none */
export function writeFilters(all: Clause[] | undefined): string | null {
  return all && all.length ? encodeUrlJson({ all }) : null;
}

/** a StudyViewFilter's clinicalDataFilters value: `{value}` or a bin `{start?, end?}` */
type DataFilterValue = { value?: string; start?: number; end?: number };
type ClinicalDataFilter = { attributeId?: string; values?: DataFilterValue[] };

/** one legacy filter value as a clinical leaf; a reason when it has none */
function valueLeaf(attribute: string, v: DataFilterValue): ClinicalLeaf | string {
  const num = (x: unknown) => x != null && Number.isFinite(Number(x));
  if (v.value != null && v.start == null && v.end == null) {
    if (/^(na|nan|n\/a)$/i.test(String(v.value).trim())) return "the NA value of " + attribute;
    return { kind: "clinical", attribute, values: [String(v.value)] };
  }
  if (!num(v.start) && !num(v.end)) return "a value of " + attribute + " with neither a value nor a range";
  if (num(v.start) && num(v.end) && Number(v.start) === Number(v.end)) return { kind: "clinical", attribute, op: "=", value: Number(v.start) };
  return { kind: "clinical", attribute, range: { ...(num(v.start) ? { gt: Number(v.start) } : {}), ...(num(v.end) ? { lte: Number(v.end) } : {}) } };
}

/** one chart's legacy values as one clause: words as one value list, ranges OR'd */
function chartClause(attribute: string, values: DataFilterValue[], refused: string[]): Clause | null {
  const leaves: ClinicalLeaf[] = [];
  const words: string[] = [];
  for (const v of values) {
    const l = valueLeaf(attribute, v);
    if (typeof l === "string") refused.push(l);
    else if (l.values) words.push(...l.values.map(String));
    else leaves.push(l);
  }
  if (words.length) leaves.push(words.length === 1 ? { kind: "clinical", attribute, op: "=", value: words[0] } : { kind: "clinical", attribute, values: words });
  if (!leaves.length) return null;
  if (leaves.length > ANY_LIMIT) { refused.push(attribute + "'s " + leaves.length + " ranges (at most " + ANY_LIMIT + ")"); return null; }
  return leaves.length === 1 ? leaves[0] : { any: leaves };
}

const ATTR = /^[A-Za-z0-9_.-]{1,200}$/;

/** A cbioportal.org StudyViewFilter (`#filterJson=`, `filters=`) as clauses, with what it held that has none. */
export function fromStudyViewFilter(f: unknown): UrlFilters {
  if (!f || typeof f !== "object" || Array.isArray(f)) return { all: [], refused: ["a filter that is not a JSON object"] };
  const all: Clause[] = [], refused: string[] = [];
  const o = f as Record<string, unknown>;
  for (const c of (Array.isArray(o.clinicalDataFilters) ? o.clinicalDataFilters : []) as ClinicalDataFilter[]) {
    const attr = String(c?.attributeId ?? "");
    if (!ATTR.test(attr)) { refused.push("a clinical filter with no valid attributeId"); continue; }
    const clause = chartClause(attr, Array.isArray(c.values) ? c.values : [], refused);
    if (clause) all.push(clause);
  }
  const studies = Array.isArray(o.studyIds) ? o.studyIds.map(String).filter((s) => /^[A-Za-z0-9._-]+$/.test(s)) : undefined;
  for (const [k, v] of Object.entries(o)) {
    if (k === "clinicalDataFilters" || k === "studyIds" || k === "alterationFilter") continue;
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    refused.push(k);
  }
  return { all, ...(studies?.length ? { studies } : {}), ...(refused.length ? { refused } : {}) };
}

/**
 * `filterAttributeId` + `filterValues` (STV-URL-2): values split on commas (`\,` keeps one),
 * trimmed; values that are all `a-b` ranges are bins (start, end], otherwise words. The attribute
 * id is matched as given, upper-cased as the portal's ids are.
 */
export function fromAttributeParams(attributeId: string, filterValues: string): UrlFilters {
  const attr = attributeId.trim().toUpperCase();
  if (!ATTR.test(attr)) return { all: [], refused: ["the clinical attribute " + JSON.stringify(attributeId)] };
  const parts = filterValues.split(/(?<!\\),/).map((s) => s.replace(/\\,/g, ",").trim()).filter(Boolean);
  const RANGE = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/;
  const values: DataFilterValue[] = parts.every((p) => RANGE.test(p))
    ? parts.map((p) => { const [, a, b] = p.match(RANGE)!; return { start: Number(a), end: Number(b) }; })
    : parts.map((value) => ({ value }));
  const refused: string[] = [];
  const clause = chartClause(attr, values, refused);
  return { all: clause ? [clause] : [], ...(refused.length ? { refused } : {}) };
}

/**
 * The filters a page's URL carries: its own `filters`, else a legacy StudyViewFilter in `filters`
 * or the hash's `filterJson`, else `filterAttributeId` + `filterValues`. Null when it carries none.
 */
export function readFilters(params: URLSearchParams, hash = ""): UrlFilters | null {
  const own = params.get(FILTERS_PARAM);
  if (own && !own.trim().startsWith("{")) {
    const d = readUrlJson<{ all?: Clause[] }>(own);
    return d && Array.isArray(d.all) ? { all: d.all } : { all: [], refused: ["a filters parameter that does not decode"] };
  }
  // the hash is read as the portal reads it, URI-decoded only: a "+" in a value stays a "+"
  const m = hash.match(/[#&]filterJson=([^&]*)/);
  let h: string | null;
  try { h = m ? decodeURIComponent(m[1]) : null; } catch { return { all: [], refused: ["a filterJson that is not URI-encoded"] }; }
  const json = own || h;
  if (json) {
    try { return fromStudyViewFilter(JSON.parse(json)); } catch { return { all: [], refused: ["a filterJson that is not valid JSON"] }; }
  }
  const attr = params.get("filterAttributeId"), vals = params.get("filterValues");
  if (attr && vals) return fromAttributeParams(attr, vals);
  return null;
}
