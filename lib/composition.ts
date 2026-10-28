// Composition view: the SQL that turns a cohort's cases into composition vectors — one value per
// part, the parts being a generic-assay profile's entities or a list of numeric clinical
// attributes — and the rules a view's spec must keep.
//
// Every query builds the vectors inside the database (`casesCte`). What leaves it is either sums
// over the cases (compositionMomentsSql, lib/federation-views.ts — any participant) or the vectors
// themselves without their case ids (compositionCasesSql — PatientLevelResolver alone, as the plot
// view's points are).
import { sq } from "./compiler.ts";
import { axisSelect } from "./plot.ts";
import { ATTR_NAME_RE } from "./custom-data.ts";
import { finiteSql } from "./sql-number.ts";
import { assayInCohortSql } from "./generic-assay.ts";
import { patientSql, type PatientSql } from "./sql-kinds.ts";

/** the most parts one figure can tell apart: the categorical palette, then its tints */
export const COMPOSITION_MAX_PARTS = 16;
/** per cohort, the most cases drawn as bars; past it the cohort is drawn as its mean alone, and says so */
export const COMPOSITION_CASES_CAP = 2000;
/** added to both means before their ratio is logged, so a part absent from one side has a finite ratio */
export const COMPOSITION_EPS = 0.001;

const ENTITY_RE = /^[A-Za-z0-9_.:+-]{1,96}$/;
const PROFILE_RE = /^[A-Za-z0-9_.-]{1,96}$/;

/** What the SQL needs to know about the parts, once the runner has resolved them. */
export interface CompositionSource {
  kind: "genericAssay" | "clinical";
  /** entity stable ids or attribute names, in the order the parts are drawn */
  parts: string[];
  /** one composition per sample or per patient */
  unit: "sample" | "patient";
  /** generic assay only */
  profileType?: string;
  normalize: boolean;
}

/** Checks a source before any SQL is built from it; throws naming what is wrong. */
export function validateSource(s: CompositionSource): void {
  if (s.parts.length < 2) throw new Error("a composition needs at least 2 parts; this has " + s.parts.length);
  if (s.parts.length > COMPOSITION_MAX_PARTS)
    throw new Error("a composition view draws at most " + COMPOSITION_MAX_PARTS + " parts (the colours a figure can tell apart); this asks for " +
      s.parts.length + " — choose them with `entities`, or pool the rest into an attribute of their own");
  if (new Set(s.parts).size < s.parts.length) throw new Error("a part is named twice");
  if (s.kind === "genericAssay") {
    if (!PROFILE_RE.test(String(s.profileType || ""))) throw new Error("profileType names a generic-assay profile");
    for (const e of s.parts) if (!ENTITY_RE.test(e)) throw new Error("entity " + JSON.stringify(e) + " is not an entity id");
  } else {
    for (const a of s.parts) if (!ATTR_NAME_RE.test(a)) throw new Error("attribute " + JSON.stringify(a) + " is not an attribute name");
  }
}

/**
 * (id, c, v): each of the cohort's cases' value for each part, c the part's 0-based index. Reads the
 * `cohort` CTE the caller defines. A generic-assay value that is not a number is no value.
 */
export function partsSql(s: CompositionSource, study: string, db: string, cohortSql: string): string {
  validateSource(s);
  if (s.kind === "genericAssay") {
    const idCol = s.unit === "patient" ? "patient_unique_id" : "sample_unique_id";
    return "SELECT id, c, assumeNotNull(avg(val)) AS v FROM (\n" +
      "  SELECT " + idCol + " AS id, toUInt16(indexOf([" + s.parts.map(sq).join(",") + "], entity_stable_id) - 1) AS c,\n" +
      "         " + finiteSql("value") + " AS val\n" +
      "  FROM " + db + ".generic_assay_data_derived\n" +
      "  WHERE profile_type = " + sq(s.profileType!) + " AND profile_stable_id = " + sq(study + "_" + s.profileType) + "\n" +
      "    AND entity_stable_id IN (" + s.parts.map(sq).join(",") + ")\n" +
      "    AND " + assayInCohortSql(study) + "\n" +
      ") WHERE isFinite(ifNull(val, nan)) GROUP BY id, c";
  }
  const ctx = { study, db, unit: s.unit, cohortSql };
  return s.parts.map((a, i) =>
    "SELECT id, toUInt16(" + i + ") AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (\n" +
    axisSelect({ source: "clinical", attribute: a }, ctx, "num") + "\n)) WHERE isFinite(ifNull(av, nan))").join("\nUNION ALL\n");
}

/**
 * The CTEs every composition query starts from:
 * - `raw`: per case with any part, how many parts it has (k), their sum and smallest value, and its values in part order;
 * - `cases`: the cases with every part, none below zero and a sum above zero — `ps` the values the
 *   view compares (shares of the sum when normalising, else as recorded), `sh` the shares, `h` the
 *   Shannon entropy of the shares (natural log).
 */
export function casesCte(s: CompositionSource, study: string, db: string, cohortSql: string): string {
  const k = s.parts.length;
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "parts AS (\n" + partsSql(s, study, db, cohortSql) + "\n),\n" +
    "raw AS (\n" +
    "  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs\n" +
    "  FROM parts GROUP BY id\n" +
    "),\n" +
    "cases AS (\n" +
    "  SELECT id, " + (s.normalize ? "arrayMap(x -> x / tot, vs)" : "vs") + " AS ps, arrayMap(x -> x / tot, vs) AS sh,\n" +
    "         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h\n" +
    "  FROM raw WHERE k = " + k + " AND lo >= 0 AND tot > 0\n" +
    ")\n";
}

/**
 * The cases' composition vectors, without their ids, ordered by part `sortIndex` (0-based),
 * highest first; ties fall in a fixed pseudo-random order, so the figure does not move between
 * runs. One more row than `cap` is asked for, so the caller can tell "exactly cap" from "more".
 * Case-level: PatientLevelResolver.compositionCases is its only caller.
 */
export function compositionCasesSql(s: CompositionSource, study: string, db: string, cohortSql: string, sortIndex: number,
  cap = COMPOSITION_CASES_CAP): PatientSql {
  if (!(Number.isInteger(sortIndex) && sortIndex >= 0 && sortIndex < s.parts.length)) throw new Error("sort names no part");
  return patientSql(casesCte(s, study, db, cohortSql) +
    "SELECT ps, h FROM cases ORDER BY ps[" + (sortIndex + 1) + "] DESC, cityHash64(id)\n" +
    "LIMIT " + (Math.floor(cap) + 1));
}

/** How the figure names the parts: attribute names lose the prefix they all share
 *  (custom:spectrum-sc-tnk/TNK_CD8_T_ISG → CD8_T_ISG); entities keep their own names. */
export function partNames(ids: string[], names?: Map<string, string>): string[] {
  if (names) return ids.map((e) => names.get(e) || e);
  let pre = ids[0] || "";
  for (const a of ids) while (pre && !a.startsWith(pre)) pre = pre.slice(0, -1);
  // keep whole words: cut back to the last separator inside the prefix
  const cut = Math.max(pre.lastIndexOf("/"), pre.lastIndexOf("_"), pre.lastIndexOf(":"));
  const p = cut >= 0 ? pre.slice(0, cut + 1) : "";
  return ids.map((a) => (a.slice(p.length) || a).replace(/_/g, " "));
}
