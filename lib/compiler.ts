// The timeline sub-DSL -> ClickHouse SQL. Server-side only.
//
// A cohort is the patients with an event A (a selector: an event type, up to three attribute
// matches, a numeric test, a minimum duration, and which occurrence counts), optionally related
// to a second event B:
//   BEFORE {minDays, maxDays}  B starts more than minDays and at most maxDays days after A
//   DURING                     B starts within A's span, A's first and last day included
//   NOT_FOLLOWED_BY {withinDays, observed?}  no B within withinDays days after A
// Dates are whole days relative to each patient's own reference date, so the order of two events
// on the same day is unknown; the comparisons below are chosen with that in mind.
// "Treatment line (derived)" is not a recorded event type: it reads the lines built by
// lib/treatment-lines.ts. Semantics pinned by test/compiler.test.ts.
import type { EventSelector, EventRel, Occurrence } from "./types.ts";
import { foldedEqualsSql, canonicalEventName } from "./event-names.ts";
import { linesCtes, compositionKeySql, DEFAULT_LINE_GAP, LINE_TYPE } from "./treatment-lines.ts";
import { finiteSql } from "./sql-number.ts";

/** A selector after runtime validation: defaults applied, fields narrowed. */
export interface ValidSelector {
  eventType: string;
  attrs: { key: string; value: string }[];
  occurrence: Occurrence;
  numeric: { key: string; op: string; value: number } | null;
  minDurationDays: number | null;
}

export function sq(s: unknown): string { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }

/**
 * One study's rows of mutation_derived. The table is sorted by molecularProfileId, never by
 * studyId, and a study's profile ids all start "<study>_": the prefix lets ClickHouse skip every
 * other study's granules instead of scanning all 19M rows. The prefix also matches sibling studies
 * named after this one (brca_tcga_ → brca_tcga_pub_…), so studyId still decides which rows count.
 */
export function mutationStudySql(study: string): string {
  return "startsWith(molecularProfileId, " + sq(study + "_") + ") AND studyId = " + sq(study);
}

function studyPatientsCte(db: string, study: string): string {
  return "study_patients AS (\n  SELECT p.internal_id FROM " + db + ".patient p\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n)";
}

export const PRIOR_MED_KEY = "PRIOR_MED_TO_MSK";

// priorGuard: "first line" in a record means first line seen at this institution, and patients
// referred after treatment elsewhere have an earlier line the record lacks. Treatment-naive means
// a "No prior medications" record under PRIOR_MED_TO_MSK, a key only MSK's own studies carry.
// A patient with no record either way is left out: unknown is not naive. A study that records
// the key for no one would leave the cohort silently empty, so the query refuses it instead.
function priorMedCte(db: string, study: string): string {
  const flagged = (value: string | null) =>
    "FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".clinical_event_data pm ON pm.clinical_event_id = ce.clinical_event_id\n" +
    "    AND " + foldedEqualsSql("pm.key", PRIOR_MED_KEY) + (value ? " AND " + foldedEqualsSql("pm.value", value) : "") + "\n" +
    "  WHERE ce.patient_id IN (SELECT internal_id FROM study_patients)";
  const refusal = "priorGuard needs the " + PRIOR_MED_KEY + " treatment flag, and " + study +
    " records it for no patient; drop priorGuard, or use a study that records it";
  return "nopriormed AS (\n  SELECT ce.patient_id AS patient_id " + flagged("No prior medications") + "\n" +
    "    AND (SELECT throwIf(count() = 0, " + sq(refusal) + ") " + flagged(null) + ") = 0\n)";
}

const OCCURRENCES = new Set(["ANY", "FIRST", "LAST"]);
const REL_TYPES = new Set(["NONE", "BEFORE", "DURING", "NOT_FOLLOWED_BY"]);
const NUM_OPS: Record<string, string> = { ">": ">", ">=": ">=", "<": "<", "<=": "<=", "=": "=" };

function asNum(x: unknown, name: string): number {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error("invalid number for " + name);
  return n;
}

export function validateSelector(sel: EventSelector | null | undefined): ValidSelector {
  if (!sel || typeof sel.eventType !== "string" || !sel.eventType || sel.eventType.length > 200)
    throw new Error("invalid eventType");
  // blank attribute rows are an unfinished form, not a condition; anything else unknown is refused
  const attrs = (sel.attrs || []).filter((a) => a && a.key && a.value)
    .map((a) => ({ key: String(a.key).slice(0, 200), value: String(a.value).slice(0, 500) }));
  if (attrs.length > 3) throw new Error("an event selector takes at most 3 attribute matches; this has " + attrs.length);
  if (sel.occurrence && !OCCURRENCES.has(sel.occurrence)) throw new Error("occurrence must be ANY, FIRST or LAST, not " + JSON.stringify(sel.occurrence));
  const occurrence: Occurrence = sel.occurrence || "ANY";
  let numeric: ValidSelector["numeric"] = null;
  if (sel.numeric && sel.numeric.key && sel.numeric.value !== "" && sel.numeric.value != null) {
    const op = sel.numeric.op ? NUM_OPS[sel.numeric.op as string] : ">";
    if (!op) throw new Error("numeric op must be one of " + Object.keys(NUM_OPS).join(" ") + ", not " + JSON.stringify(sel.numeric.op));
    numeric = { key: String(sel.numeric.key).slice(0, 200), op, value: asNum(sel.numeric.value, "numeric value") };
  }
  const minDurationDays = sel.minDurationDays ? asNum(sel.minDurationDays, "minDurationDays") : null;
  return { eventType: sel.eventType, attrs, occurrence, numeric, minDurationDays };
}

function selectorCte(name: string, sel: ValidSelector, db: string, priorGuard: boolean): string {
  const joins: string[] = [], conds: string[] = [foldedEqualsSql("ce.event_type", sel.eventType)];
  sel.attrs.forEach((a, i: number) => {
    joins.push("JOIN " + db + ".clinical_event_data a" + i +
      " ON a" + i + ".clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("a" + i + ".key", a.key) +
      " AND " + foldedEqualsSql("a" + i + ".value", a.value));
  });
  if (sel.numeric) {
    joins.push("JOIN " + db + ".clinical_event_data nx ON nx.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("nx.key", sel.numeric.key));
    conds.push(finiteSql("nx.value") + " " + sel.numeric.op + " " + sel.numeric.value);
  }
  if (sel.minDurationDays) {
    conds.push("ce.stop_date IS NOT NULL AND ce.stop_date - ce.start_date >= " + sel.minDurationDays);
  }
  conds.push("ce.patient_id IN (SELECT internal_id FROM study_patients)");
  if (priorGuard) conds.push("ce.patient_id IN (SELECT patient_id FROM nopriormed)");
  let base = "SELECT ce.patient_id, ce.start_date, ce.stop_date\n  FROM " + db + ".clinical_event ce\n  " +
    joins.join("\n  ") + (joins.length ? "\n  " : "") + "WHERE " + conds.join("\n    AND ");
  if (sel.occurrence === "FIRST" || sel.occurrence === "LAST") {
    // never alias an aggregate back to its source column name (ClickHouse alias substitution)
    const agg = sel.occurrence === "FIRST" ? "argMin" : "argMax", mm = sel.occurrence === "FIRST" ? "min" : "max";
    base = "SELECT patient_id, occ_start AS start_date, occ_stop AS stop_date FROM (\n" +
      "  SELECT patient_id, " + mm + "(start_date) AS occ_start, " + agg + "(stop_date, start_date) AS occ_stop\n" +
      "    FROM (" + base + ") GROUP BY patient_id)";
  }
  return name + " AS (\n" + base + "\n)";
}

export interface CompileCohortArgs {
  db: string; study: string;
  a: EventSelector; b?: EventSelector | null; rel?: EventRel | null;
  priorGuard?: boolean; lineGap?: number | null; patientsLimit?: number;
}
export interface CompiledCohort {
  countSql: string; patientsSql: string; histSql: string | null; histBucket: number;
}

export function compileCohort({ db, study, a: aIn, b: bIn, rel, priorGuard, lineGap: lineGapIn, patientsLimit }: CompileCohortArgs): CompiledCohort {
  const A = "sel_a", B = "sel_b";
  const a = validateSelector(aIn);
  let b: ValidSelector | null = null;
  if (rel && rel.type && !REL_TYPES.has(rel.type)) throw new Error("rel.type must be one of " + [...REL_TYPES].join(", ") + ", not " + JSON.stringify(rel.type));
  const relType = rel?.type || "NONE";
  if (relType !== "NONE") b = validateSelector(bIn);
  const isLine = (s: ValidSelector | null): boolean => !!s && canonicalEventName(s.eventType) === canonicalEventName(LINE_TYPE);
  // shared page-level gap setting; a selector-level GAP attribute still overrides
  const lineGap = (() => {
    for (const s of [a, relType !== "NONE" ? b : null]) {
      if (!isLine(s)) continue;
      const g = (s!.attrs || []).find((x) => canonicalEventName(x.key) === "gap");
      if (g) return asNum(g.value, "GAP");
    }
    return lineGapIn != null ? asNum(lineGapIn, "lineGap") : DEFAULT_LINE_GAP;
  })();
  const ctes = [studyPatientsCte(db, study)];
  if (priorGuard) ctes.push(priorMedCte(db, study));
  if (isLine(a) || (relType !== "NONE" && isLine(b)))
    ctes.push(...linesCoreCtes(db, study, lineGap, !!priorGuard));
  // The guard filters A alone: every relation reaches B only through A's patients.
  ctes.push(isLine(a) ? lineSelectorCte(A, a) : selectorCte(A, a, db, !!priorGuard));
  const joins: string[] = [], wheres: string[] = [];
  let maxDays = 0, minDays = 0;
  if (relType !== "NONE") {
    ctes.push(isLine(b) ? lineSelectorCte(B, b!) : selectorCte(B, b!, db, false));
    if (relType === "BEFORE") {
      const relB = rel as Extract<EventRel, { type: "BEFORE" }>;
      minDays = asNum(relB.minDays || 0, "minDays"); maxDays = asNum(relB.maxDays, "maxDays");
      // strictly after: a B on A's own day may have come first, so it is not "after" A
      joins.push("JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id");
      wheres.push(B + ".start_date > " + A + ".start_date + " + minDays +
        " AND " + B + ".start_date <= " + A + ".start_date + " + maxDays);
    } else if (relType === "DURING") {
      // A's first and last day count; an A with no stop date is a one-day event
      joins.push("JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id");
      wheres.push(B + ".start_date >= " + A + ".start_date AND " + B +
        ".start_date <= coalesce(" + A + ".stop_date, " + A + ".start_date)");
    } else if (relType === "NOT_FOLLOWED_BY") {
      const relN = rel as Extract<EventRel, { type: "NOT_FOLLOWED_BY" }>;
      // A patient is excluded if ANY of their A occurrences is followed by B in the window; with
      // occurrence FIRST or LAST there is one A per patient. Absence of B can also mean the record
      // ends before the window does: `observed` keeps only patients whose last recorded event of any
      // type starts at least withinDays after A, so "not followed" was there to be seen.
      const w = asNum(relN.withinDays, "withinDays");
      wheres.push(A + ".patient_id NOT IN (SELECT a2.patient_id FROM " + A + " AS a2 JOIN " + B +
        " ON " + B + ".patient_id = a2.patient_id AND " + B + ".start_date > a2.start_date AND " +
        B + ".start_date <= a2.start_date + " + w + ")");
      if (relN.observed) {
        ctes.push("obs AS (\n  SELECT patient_id, max(start_date) AS max_date FROM " + db + ".clinical_event\n" +
          "  WHERE patient_id IN (SELECT internal_id FROM study_patients) GROUP BY patient_id\n)");
        joins.push("JOIN obs ON obs.patient_id = " + A + ".patient_id");
        wheres.push("obs.max_date >= " + A + ".start_date + " + w);
      }
    }
  }
  const body = "FROM " + A + (joins.length ? "\n  " + joins.join("\n  ") : "") +
    (wheres.length ? "\nWHERE " + wheres.join("\n  AND ") : "");
  const withBlock = "WITH\n" + ctes.join(",\n") + "\n";
  // denom: the patients with A at all (after the guard), before any relation to B
  const countSql = withBlock +
    "SELECT uniqExact(" + A + ".patient_id) AS matched,\n" +
    "       (SELECT uniqExact(patient_id) FROM " + A + ") AS denom\n" + body;
  const patientsSql = withBlock +
    "SELECT DISTINCT p.stable_id AS pid\n" + body.replace("FROM " + A,
      "FROM " + A + "\n  JOIN " + db + ".patient p ON p.internal_id = " + A + ".patient_id") +
    (wheres.length ? "\n" : "\nWHERE 1\n") + "ORDER BY pid LIMIT " +
    (Number.isFinite(Number(patientsLimit)) ? Number(patientsLimit) : 24);
  let histSql: string | null = null, histBucket = 0;
  if (relType === "BEFORE") {
    histBucket = Math.max(1, Math.round(maxDays / 12));
    histSql = withBlock +
      "SELECT toInt32(intDiv(gap, " + histBucket + ") * " + histBucket + ") AS bucket, count() AS n FROM (\n" +
      "  SELECT " + A + ".patient_id AS patient_id, min(" + B + ".start_date - " + A + ".start_date) AS gap\n" +
      "  FROM " + A + " JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id\n" +
      "  WHERE " + B + ".start_date > " + A + ".start_date + " + minDays + "\n" +
      "  GROUP BY patient_id)\n" +
      "WHERE gap <= " + maxDays + " GROUP BY bucket ORDER BY bucket";
  }
  return { countSql, patientsSql, histSql, histBucket };
}

export { LINE_TYPE };

/** The shared line definition (lib/treatment-lines.ts) for this study's patients, as `line_events`. */
function linesCoreCtes(db: string, study: string, gap: number, priorGuard: boolean): string[] {
  return [
    ...linesCtes({ db, study, spec: { gap },
      patientFilter: "ce.patient_id IN (SELECT internal_id FROM study_patients)" + (priorGuard ? " AND ce.patient_id IN (SELECT patient_id FROM nopriormed)" : "") }),
    "line_events AS (\n  SELECT patient_id, line_no, ls AS start_date, le AS stop_date, combo FROM lines\n)"
  ];
}

function lineSelectorCte(name: string, sel: ValidSelector): string {
  const conds = ["1"];
  sel.attrs.forEach((a) => {
    const k = canonicalEventName(a.key);
    if (k === "line_no") conds.push("line_no = " + asNum(a.value, "LINE_NO"));
    else if (k === "composition") conds.push(compositionKeySql("combo") + " = " + compositionKeySql(sq(a.value)));
    else if (k === "gap") { /* consumed by compileCohort */ }
    else throw new Error("'" + LINE_TYPE + "' supports attributes LINE_NO, COMPOSITION, GAP");
  });
  if (sel.numeric) {
    if (canonicalEventName(sel.numeric.key) !== "line_no") throw new Error("numeric predicate on '" + LINE_TYPE + "' supports only LINE_NO");
    conds.push("line_no " + sel.numeric.op + " " + sel.numeric.value);
  }
  if (sel.minDurationDays) conds.push("stop_date - start_date >= " + sel.minDurationDays);
  let base = "SELECT patient_id, start_date, stop_date FROM line_events\n  WHERE " + conds.join(" AND ");
  if (sel.occurrence === "FIRST" || sel.occurrence === "LAST") {
    const agg = sel.occurrence === "FIRST" ? "argMin" : "argMax", mm = sel.occurrence === "FIRST" ? "min" : "max";
    base = "SELECT patient_id, occ_start AS start_date, occ_stop AS stop_date FROM (\n" +
      "  SELECT patient_id, " + mm + "(start_date) AS occ_start, " + agg + "(stop_date, start_date) AS occ_stop\n" +
      "    FROM (" + base + ") GROUP BY patient_id)";
  }
  return name + " AS (\n" + base + "\n)";
}

export function compileLines(db: string, study: string, gapDays: number, priorGuard: boolean): { histSql: string; transSql: string } {
  const gap = asNum(gapDays, "gap");
  if (gap < 1 || gap > 3650) throw new Error("gap out of range");
  const ctes = [studyPatientsCte(db, study)];
  if (priorGuard) ctes.push(priorMedCte(db, study));
  ctes.push(...linesCoreCtes(db, study, gap, priorGuard));
  const withBlock = "WITH\n" + ctes.join(",\n") + "\n";
  const histSql = withBlock +
    "SELECT toUInt32(least(n_lines, 8)) AS bucket, count() AS n FROM (\n" +
    "  SELECT patient_id, max(line_no) AS n_lines FROM lines GROUP BY patient_id)\n" +
    "GROUP BY bucket ORDER BY bucket";
  // ties on n broken by the combinations, so the top 12 are the same on every run
  const transSql = withBlock +
    "SELECT l1.combo AS line1, l2.combo AS line2, count() AS n\n" +
    "FROM (SELECT * FROM lines WHERE line_no = 1) l1\n" +
    "JOIN (SELECT * FROM lines WHERE line_no = 2) l2 ON l2.patient_id = l1.patient_id\n" +
    "GROUP BY line1, line2 ORDER BY n DESC, line1, line2 LIMIT 12";
  return { histSql, transSql };
}

export function lineCatalogSqls(db: string, study: string, gap = DEFAULT_LINE_GAP): { stats: string; combos: string } {
  const withBlock = "WITH\n" + [studyPatientsCte(db, study), ...linesCoreCtes(db, study, gap, false)].join(",\n") + "\n";
  return {
    stats: withBlock + "SELECT uniqExact(patient_id) AS n_pat, count() AS n_ev FROM line_events",
    combos: withBlock + "SELECT combo, count() AS n FROM line_events GROUP BY combo ORDER BY n DESC, combo LIMIT 25"
  };
}

export function catalogSqls(db: string, study: string): Record<string, string> {
  const withBlock = "WITH\n" + studyPatientsCte(db, study) + "\n";
  return {
    studyCheck: "SELECT count() AS n FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study),
    patientCount: "SELECT uniqExact(patient_unique_id) AS n FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + sq(study),
    types: withBlock +
      "SELECT ce.event_type AS t, uniqExact(ce.patient_id) AS n_pat, count() AS n_ev\n" +
      "FROM " + db + ".clinical_event ce WHERE ce.patient_id IN (SELECT internal_id FROM study_patients)\n" +
      "GROUP BY t ORDER BY n_pat DESC",
    // clinical_event_data_derived is the event data pre-joined to its event and study, sorted by
    // study and event type, so these read one study's rows with no join
    values:
      "SELECT event_type AS t, key AS k, value AS v, uniqExact(patient_unique_id) AS n\n" +
      "FROM " + db + ".clinical_event_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + "\n" +
      "GROUP BY t, k, v HAVING n >= 10 ORDER BY n DESC, v LIMIT 25 BY t, k",
    keys:
      "SELECT event_type AS t, key AS k, uniqExact(value) AS nv\n" +
      "FROM " + db + ".clinical_event_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + "\n" +
      "GROUP BY t, k ORDER BY t, k"
  };
}
