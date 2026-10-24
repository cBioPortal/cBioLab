// The actionability view's SQL: what its runner (run.ts) asks each participant's database for.
import { pidOf } from "../../federation-views.ts";
import { clinicalTable } from "../../custom-data.ts";
import { sq } from "../../compiler.ts";

/**
 * Per group (a clinical attribute's value per patient — "Multiple" when their samples disagree,
 * "" when none is recorded — or one group without `groupBy`) and per pair of a patient's best
 * sensitive and resistance ranks over every sequenced sample: the number of patients. Counts only.
 */
export function actionLevelsSql(cohortSql: string, study: string, db: string, pin: string, groupBy: string | null): string {
  if (groupBy && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(groupBy)) throw new Error("bad attribute name '" + String(groupBy).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  return (
    actionCtes(cohortSql, study, db, pin) + ",\n" +
    "pl AS (\n" +
    "  SELECT seq.pid AS pid, min(if(lv.s = 0, 9, lv.s)) AS s, min(if(lv.r = 0, 9, lv.r)) AS r\n" +
    "  FROM seq LEFT JOIN lv ON lv.sid = seq.sid\n" +
    "  GROUP BY pid\n" +
    ")" +
    (groupBy ?
      ",\ngrp AS (\n" +
      "  SELECT " + pid + " AS pid, if(uniqExact(attribute_value) > 1, 'Multiple', any(attribute_value)) AS g\n" +
      "  FROM " + clinicalTable(db, [groupBy]) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(groupBy) + " AND trimBoth(attribute_value) != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT " + (groupBy ? "grp.g" : "''") + " AS grp, pl.s AS level, pl.r AS resistance, count() AS n\n" +
    "FROM pl" + (groupBy ? " LEFT JOIN grp ON grp.pid = pl.pid" : "") + "\n" +
    "GROUP BY grp, level, resistance"
  );
}

/**
 * Patients with a sequenced sample on each side of a sample attribute (e.g. SAMPLE_TYPE Primary
 * against Metastasis, values matched case-insensitively): per pair of their best sensitive rank
 * on side a and on side b, the number of patients. Counts only.
 */
export function actionConcordanceSql(cohortSql: string, study: string, db: string, pin: string, by: { attribute: string; a: string[]; b: string[] }): string {
  if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(by.attribute)) throw new Error("bad attribute name '" + String(by.attribute).slice(0, 40) + "'");
  const side = (vals: string[]) => "lower(trimBoth(attribute_value)) IN (" + vals.map((v) => sq(String(v).trim().toLowerCase())).join(", ") + ")";
  return (
    actionCtes(cohortSql, study, db, pin) + ",\n" +
    "st AS (\n" +
    "  SELECT sample_unique_id AS sid, multiIf(" + side(by.a) + ", 'a', " + side(by.b) + ", 'b', '') AS side\n" +
    "  FROM " + clinicalTable(db, [by.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(by.attribute) + "\n" +
    "    AND sample_unique_id IN (SELECT sid FROM seq)\n" +
    "),\n" +
    "ps AS (\n" +
    "  SELECT seq.pid AS pid, minIf(if(lv.s = 0, 9, lv.s), st.side = 'a') AS sa, minIf(if(lv.s = 0, 9, lv.s), st.side = 'b') AS sb,\n" +
    "         countIf(st.side = 'a') AS na, countIf(st.side = 'b') AS nb\n" +
    "  FROM seq INNER JOIN st ON st.sid = seq.sid LEFT JOIN lv ON lv.sid = seq.sid\n" +
    "  GROUP BY pid\n" +
    "  HAVING na > 0 AND nb > 0\n" +
    ")\n" +
    "SELECT sa AS a, sb AS b, count() AS n FROM ps GROUP BY a, b"
  );
}

/** The alteration types the store holds a therapeutic level for at `pin` (reference data, no cohort). */
export function actionStoreTypesSql(_study: string, _db: string, pin: string): string {
  return "SELECT toString(alteration_type) AS type, count() AS n FROM oncokb_annotation.variant_annotation\n" +
    "WHERE oncokb_version = " + sq(pin) + " AND (highest_sensitive_level != '' OR highest_resistance_level != '')\nGROUP BY type";
}

// ---------------------------------------------------------------------------
// actionability: each patient's highest OncoKB therapeutic level

/** OncoKB's sensitive levels, best first, and the resistance levels; rank 9 is none */
export const SENSITIVE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3A", "LEVEL_3B", "LEVEL_4"] as const;
export const RESISTANCE_LEVELS = ["LEVEL_R1", "LEVEL_R2"] as const;
export const rankOf = (col: string, levels: readonly string[]) => "multiIf(" + levels.map((l, i) => col + " = " + sq(l) + ", " + (i + 1)).join(", ") + ", 9)";

/** the cohort's samples sequenced for mutations, and per sample its best sensitive and resistance
 *  rank over its called mutations and high-level copy-number calls (OncoKB at `pin`) */
function actionCtes(cohortSql: string, study: string, db: string, pin: string): string {
  const sdPid = pidOf("sd.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "seq AS (\n" +
    "  SELECT DISTINCT sp.sample_unique_id AS sid, " + sdPid + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "lv AS (\n" +
    "  SELECT g.sample_unique_id AS sid, min(" + rankOf("ann.highest_sensitive_level", SENSITIVE_LEVELS) + ") AS s,\n" +
    "         min(" + rankOf("ann.highest_resistance_level", RESISTANCE_LEVELS) + ") AS r\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    // the store's rows with a level at the pin only — a few thousand of its millions — matched as driverJoin matches
    "  INNER JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, highest_sensitive_level, highest_resistance_level\n" +
    "      FROM oncokb_annotation.variant_annotation\n" +
    "      WHERE oncokb_version = " + sq(pin) + " AND (highest_sensitive_level != '' OR highest_resistance_level != '')) ann\n" +
    "    ON ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
    "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
    "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
    "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')\n" +
    "    AND g.sample_unique_id IN (SELECT sid FROM seq)\n" +
    "  GROUP BY sid\n" +
    ")"
  );
}
