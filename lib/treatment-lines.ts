// Treatment lines: THE definition, used by every view, cohort clause and tool that counts lines.
//
// A line is one treatment decision. Records are grouped into lines by a gap rule: a record
// starts a new line when it begins more than `gap` days after the latest stop of every record
// before it, so overlapping or closely spaced therapies (a combination, or a switch within the
// gap) are one line. That rule was already shared; what differed between the sequence view, the
// DSL's "Treatment line (derived)" and the `lines` cohort metric was WHICH RECORDS went in — any
// labelled record, MSK's six SUBTYPE values matched case-sensitively, or every record — so
// "number of lines" depended on where it was asked. This module is the single answer.
//
// WHICH RECORDS. Treatment events (the `eventType` a study uses for therapies, "Treatment" by
// default) whose class is systemic therapy. The class is the event's
// SUBTYPE, or its TREATMENT_TYPE when it has no SUBTYPE: SUBTYPE first, because where both
// exist (MSK-CHORD) SUBTYPE is the specific one and TREATMENT_TYPE a generic "Medical Therapy"
// that also sits on SUBTYPE's provenance marker "Prior Medications to MSK". Systemic means the
// class is on SYSTEMIC_LINE_CLASSES — an allowlist, because the warehouse's class vocabulary has
// a long tail of study-specific phrases ("line 1 pre impact", "adjuvant", "palliative") that no
// exclusion list could anticipate; what falls outside it is counted and named by the caller,
// never silently dropped. Radiation, surgery, bone-modifying and ancillary treatment are not
// systemic lines. A document can widen the set (`lineClasses`) or take every record ("all").
//
// Names fold for case and whitespace only (lib/event-names.ts), on event type, key and value.

import { nameFoldSql, foldedEqualsSql, foldedInSql } from "./event-names.ts";

/** Systemic-therapy classes, folded, covering both the SUBTYPE and TREATMENT_TYPE vocabularies. */
export const SYSTEMIC_LINE_CLASSES = [
  "chemo", "chemotherapy",
  "immuno", "immunotherapy", "immunotherapy (including vaccines)", "vaccine",
  "targeted", "targeted therapy", "targeted molecular therapy", "targeted antibody therapy",
  "hormone", "hormone therapy", "hormonal therapy",
  "biologic", "investigational",
  "systemic therapy", "medical therapy", "pharmaceutical therapy, nos",
] as const;

export const DEFAULT_LINE_GAP = 90;
/** The synthetic event type a derived treatment line is, wherever an event clause can name one
 *  (the compiler, the cohort DSL, Explore's timeline builder, the pills that read a clause back). */
export const LINE_TYPE = "Treatment line (derived)";
/** The event type treatment records carry, and the keys their class is read from, in precedence order. */
export const TREATMENT_EVENT = "Treatment";
export const CLASS_KEYS = ["subtype", "treatment_type"] as const;

export interface LineSpec {
  /** days with no therapy that begin a new line */
  gap: number;
  /** the timeline event type that carries therapies here (default "Treatment"), matched folded */
  eventType?: string;
  /** which records form lines: the systemic classes (default), an explicit class list, or every treatment record */
  classes?: "systemic" | "all" | string[];
  /** the attribute naming each line's therapies (default: its class); a line's label is its sorted combination */
  labelKey?: string;
  /** label values whose records are left out — a document-level choice, matched folded */
  exclude?: string[];
}

export interface LinesSqlArgs {
  db: string;
  study: string;
  /** a condition on the patient, over `ce` (clinical_event) and `p` (patient) — e.g. a cohort filter */
  patientFilter: string;
  spec: LineSpec;
}

const sq = (s: string) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

export function lineGapOf(spec: LineSpec): number {
  const g = Math.floor(Number(spec.gap));
  return Number.isFinite(g) ? Math.max(1, Math.min(3650, g)) : DEFAULT_LINE_GAP;
}

/** The class list a spec selects, folded; null for every record. */
export function lineClassesOf(spec: LineSpec): string[] | null {
  if (spec.classes === "all") return null;
  if (Array.isArray(spec.classes)) return [...new Set(spec.classes.map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
  return [...SYSTEMIC_LINE_CLASSES];
}

/**
 * CTEs building lines for one study:
 *   tx(eid, patient_id, pid, s, e, cls, lbl)  the records that form lines, with their class and label
 *   numbered(..., line_no)                    each record's line
 *   lines(patient_id, pid, line_no, ls, le, combo)  one row per line: start, end, sorted combination
 * plus `txAll(eid, patient_id, cls)`, every treatment record of the study's matching patients with its
 * class (or '' with none), for callers that count what the class filter set aside.
 */
export function linesCtes({ db, study, patientFilter, spec }: LinesSqlArgs): string[] {
  const gap = lineGapOf(spec);
  const classes = lineClassesOf(spec);
  const labelKey = spec.labelKey ? String(spec.labelKey).trim().toLowerCase() : "";
  const labelIsClass = !labelKey || (CLASS_KEYS as readonly string[]).includes(labelKey);
  const exclude = [...new Set((spec.exclude || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 40);
  const fold = nameFoldSql;
  return [
    "txAll AS (\n" +
    "  SELECT ce.clinical_event_id AS eid, ce.patient_id AS patient_id, p.stable_id AS pid,\n" +
    "         ce.start_date AS s, coalesce(ce.stop_date, ce.start_date) AS e,\n" +
    "         coalesce(cl.cls, '') AS cls, coalesce(cl.cls_raw, '') AS cls_raw\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    // the class: SUBTYPE where the event has one, else TREATMENT_TYPE
    "  LEFT JOIN (\n" +
    // ties (two values under one key) break by value, so the class never depends on row order
    "    SELECT clinical_event_id, argMin(" + fold("value") + ", (" + fold("key") + " != 'subtype', " + fold("value") + ")) AS cls,\n" +
    "           argMin(trimBoth(value), (" + fold("key") + " != 'subtype', " + fold("value") + ")) AS cls_raw\n" +
    "    FROM " + db + ".clinical_event_data\n" +
    "    WHERE " + foldedInSql("key", [...CLASS_KEYS]) + " AND " + fold("value") + " != ''\n" +
    "    GROUP BY clinical_event_id\n" +
    "  ) cl ON cl.clinical_event_id = ce.clinical_event_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + foldedEqualsSql("ce.event_type", spec.eventType || TREATMENT_EVENT) + "\n" +
    "    AND " + patientFilter + "\n" +
    ")",
    "txLabelled AS (\n" +
    "  SELECT t.eid AS eid, t.patient_id AS patient_id, t.pid AS pid, t.s AS s, t.e AS e, t.cls AS cls,\n" +
    (labelIsClass
      ? "         t.cls AS lk, t.cls_raw AS lraw\n  FROM txAll t\n"
      : "         " + fold("d.value") + " AS lk, trimBoth(d.value) AS lraw\n" +
        "  FROM txAll t\n" +
        "  LEFT JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = t.eid AND " + foldedEqualsSql("d.key", labelKey) + "\n") +
    "  WHERE " + inLineClassesSql(spec, "t.cls") + "\n" +
    (exclude.length ? "    AND " + (labelIsClass ? "t.cls" : fold("d.value")) + " NOT IN (" + exclude.map((x) => fold(sq(x))).join(", ") + ")\n" : "") +
    ")",
    // display labels: for each folded label the most frequent original spelling in these records,
    // ties alphabetical — lib/event-names.ts's display rule
    "spell AS (\n" +
    "  SELECT lk, arraySort((x) -> (-x.2, x.1), groupArray((lraw, c)))[1].1 AS lbl FROM (\n" +
    "    SELECT lk, lraw, count() AS c FROM txLabelled WHERE lk != '' GROUP BY lk, lraw\n" +
    "  ) GROUP BY lk\n" +
    ")",
    "tx AS (\n" +
    "  SELECT x.eid AS eid, x.patient_id AS patient_id, x.pid AS pid, x.s AS s, x.e AS e, x.cls AS cls,\n" +
    "         if(x.lk = '', '', sp.lbl) AS lbl\n" +
    "  FROM txLabelled x LEFT JOIN spell sp ON sp.lk = x.lk\n" +
    ")",
    // toNullable: over an empty frame max() on a non-nullable column returns 0 (not NULL), which
    // corrupts first-row detection because day offsets are often <= 0
    "flagged AS (\n  SELECT *, max(toNullable(e)) OVER (PARTITION BY patient_id\n" +
    "    ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms\n  FROM tx\n)",
    "numbered AS (\n  SELECT *, sum(if(pms IS NULL OR s > pms + " + gap + ", 1, 0)) OVER (\n" +
    "    PARTITION BY patient_id ORDER BY s, e, eid ROWS UNBOUNDED PRECEDING) AS line_no\n  FROM flagged\n)",
    // a line's identity is its COMBINATION, sorted so record order cannot split one regimen in two;
    // a line whose records carry no label is named for the missing key rather than left blank
    "lines AS (\n  SELECT patient_id, any(pid) AS pid, line_no, min(s) AS ls, max(e) AS le,\n" +
    "         if(countIf(lbl != '') = 0, " + sq("(no " + (labelIsClass ? "class" : labelKey.toUpperCase()) + ")") + ",\n" +
    "            arrayStringConcat(arraySort(groupUniqArrayIf(lbl, lbl != '')), ' + ')) AS combo\n" +
    "  FROM numbered GROUP BY patient_id, line_no\n)",
  ];
}

/** A line's combination as a COMPOSITION clause compares it: folded, and blind to order and to spacing around '+'. */
export function compositionKeySql(expr: string): string {
  return "arrayStringConcat(arraySort(arrayMap((x) -> lowerUTF8(trimBoth(x)), splitByChar('+', " + expr + "))), '+')";
}

/** SQL true when a folded class `col` is one the spec builds lines from (always true for "all"). */
export function inLineClassesSql(spec: LineSpec, col: string): string {
  const classes = lineClassesOf(spec);
  return classes ? col + " IN (" + classes.map((c) => nameFoldSql(sq(c))).join(", ") + ")" : "1";
}
