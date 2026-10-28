// The molsubtype view's SQL: what its runner (run.ts) asks each participant's database for.
import { survivalMonthsSql, survivalEventSql } from "../../survival-sql.ts";
import { pidOf, orgAttr } from "../../federation-views.ts";
import { finiteSql } from "../../sql-number.ts";
import { clinicalTable } from "../../custom-data.ts";
import { sq } from "../../compiler.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { driverJoin } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { inCohortSamples, inCohortPatients, bareSampleId } from "../../cohort2.ts";

/** A clinical row of the cohort: a sample row by its sample, a patient row by its patient. */
function inCohortClinical(study: string): string {
  return "(type = 'sample' AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) +
    " OR type = 'patient' AND " + inCohortPatients(pidOf("patient_unique_id", study)) + ")";
}

/** Patients per (class, why, group). Counts only. */
export function molCountsSql(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): AggregateSql {
  return aggregateSql(molEndometrialCtes(cohortSql, study, db, o) + "\n" +
    "SELECT cls.cls AS cls, cls.why AS why, grp.g AS grp, count() AS n FROM cls LEFT JOIN grp ON grp.pid = cls.pid GROUP BY cls, why, grp");
}

/** Overall survival per class: counts of (class, months, dead) from OS_MONTHS / OS_STATUS. Counts only. */
export function molSurvivalSql(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): AggregateSql {
  const pid = pidOf("patient_unique_id", study);
  return aggregateSql(molEndometrialCtes(cohortSql, study, db, o) + ",\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid, " + survivalMonthsSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')", "anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS months,\n" +
    "         " + survivalEventSql("anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT cls.cls AS cls, round(os.months, 2) AS t, os.dead AS dead, count() AS n\n" +
    "FROM cls INNER JOIN os ON os.pid = cls.pid WHERE os.months IS NOT NULL AND os.months >= 0 AND cls.cls != 'NC' GROUP BY cls, t, dead ORDER BY t");
}

/** Which MSI attributes the cohort's samples carry, with how many values and patients. Counts only. */
export function molMsiAttributesSql(cohortSql: string, study: string, db: string): AggregateSql {
  const pid = pidOf("patient_unique_id", study);
  return aggregateSql("WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT attribute_name AS attribute, uniqExact(" + pid + ") AS patients, uniqExact(attribute_value) AS nvalues, arraySort(groupUniqArray(8)(attribute_value)) AS examples\n" +
    "FROM " + clinicalTable(db, []) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND positionCaseInsensitive(attribute_name, 'MSI') > 0 AND trimBoth(attribute_value) != ''\n" +
    "  AND " + inCohortClinical(study) + "\n" +
    "GROUP BY attribute ORDER BY patients DESC");
}

// ---------------------------------------------------------------------------
// molsubtype: a published molecular classifier applied per patient

export interface MolMsiRule {
  attribute: string;
  /** a categorical MSI call: the values meaning MSI-high and those meaning stable (case-insensitive) */
  high?: string[]; stable?: string[];
  /** a numeric score: MSI-high at or above `threshold`, stable below `stableBelow`, in between indeterminate */
  threshold?: number; stableBelow?: number;
}
export interface MolEndometrialOpts {
  /** POLE exonuclease-domain hotspots (protein changes) */
  poleHotspots: string[];
  msi: MolMsiRule;
  /** an abnormal p53: an OncoKB-driver TP53 mutation at this pin, or (null) any non-synonymous TP53 mutation */
  p53Pin: string | null;
  /** a patient attribute to cross the subtypes with */
  by: string | null;
}

/** TP53 mutation classes counted as abnormal without OncoKB: protein-changing calls */
const MOL_TP53_CLASSES = ["Missense_Mutation", "Nonsense_Mutation", "Frame_Shift_Del", "Frame_Shift_Ins", "Splice_Site", "In_Frame_Del", "In_Frame_Ins", "Nonstop_Mutation", "Translation_Start_Site", "Splice_Region"];

/**
 * `cls`: each cohort patient's endometrial molecular class — the TCGA / ProMisE / WHO 2020 hierarchy,
 * first match wins: 'POLEmut' (a POLE hotspot called in any of its cohort samples), 'MMRd' (MSI-high in
 * any of them), 'p53abn' (an abnormal TP53 mutation), 'NSMP' (none of these) — and 'NC' (not classifiable) with
 * `why` when an input the hierarchy needs before deciding is missing: not sequenced, not profiled for
 * POLE or TP53 (panel-aware), or no MSI value. Only the cohort's own samples are read. Also `grp`, the
 * `by` attribute per patient.
 */
function molEndometrialCtes(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study), pid = pidOf("patient_unique_id", study);
  const spSid = bareSampleId("sp.sample_unique_id", study), gSid = bareSampleId("g.sample_unique_id", study);
  const attr = orgAttr(o.msi.attribute);
  const hot = o.poleHotspots.map((h) => { if (!/^[A-Z][0-9]{1,5}[A-Z*]$/.test(h)) throw new Error("bad POLE hotspot '" + String(h).slice(0, 20) + "'"); return sq(h); }).join(", ");
  const v = clinicalValueFoldSql("attribute_value");
  const msiState = o.msi.threshold != null
    ? "multiIf(" + finiteSql("trimBoth(attribute_value)") + " IS NULL OR " + finiteSql("trimBoth(attribute_value)") + " < 0, 0, " + finiteSql("trimBoth(attribute_value)") + " >= " + Number(o.msi.threshold) +
      ", 2, " + finiteSql("trimBoth(attribute_value)") + " < " + Number(o.msi.stableBelow ?? o.msi.threshold) + ", 1, 0)"
    : "multiIf(" + v + " IN (" + (o.msi.high || []).map((x) => sq(x.trim().toLowerCase())).join(", ") + "), 2, " + v + " IN (" + (o.msi.stable || []).map((x) => sq(x.trim().toLowerCase())).join(", ") + "), 1, 0)";
  const by = o.by ? orgAttr(o.by) : null;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "pp AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED' AND " + inCohortSamples(spSid) + "\n" +
    "),\n" +
    "cov AS (\n" +
    "  SELECT pp.pid AS pid, max(pp.panel = 'WES' OR gp.gene = 'POLE') AS pole, max(pp.panel = 'WES' OR gp.gene = 'TP53') AS tp53\n" +
    "  FROM pp LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel AND gp.gene IN ('POLE', 'TP53')\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + gPid + " AS pid,\n" +
    "         max(g.hugo_gene_symbol = 'POLE' AND g.mutation_variant IN (" + hot + ")) AS pole_hot,\n" +
    "         max(g.hugo_gene_symbol = 'TP53' AND " + (o.p53Pin ? "ann.is_driver" : "g.mutation_type IN (" + MOL_TP53_CLASSES.map(sq).join(", ") + ")") + ") AS p53\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + (o.p53Pin ? driverJoin(o.p53Pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'\n" +
    "    AND lowerUTF8(g.mutation_status) != 'germline' AND NOT g.off_panel AND g.hugo_gene_symbol IN ('POLE', 'TP53')\n" +
    "    AND " + inCohortSamples(gSid) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "msi AS (\n" +
    "  SELECT " + pid + " AS pid, max(" + msiState + ") AS m\n" +
    "  FROM " + clinicalTable(db, [attr]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND " + inCohortClinical(study) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "cls AS (\n" +
    "  SELECT c.pid AS pid,\n" +
    "         multiIf(cov.pid = '', 'NC', mut.pole_hot = 1, 'POLEmut', cov.pole = 0, 'NC', msi.m = 2, 'MMRd', msi.m = 0, 'NC', cov.tp53 = 0, 'NC', mut.p53 = 1, 'p53abn', 'NSMP') AS cls,\n" +
    "         multiIf(cov.pid = '', 'not sequenced', mut.pole_hot = 1, '', cov.pole = 0, 'not profiled for POLE', msi.m = 2, '', msi.m = 0, 'no MSI call', cov.tp53 = 0, 'not profiled for TP53', '') AS why\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c\n" +
    "  LEFT JOIN cov ON cov.pid = c.pid LEFT JOIN mut ON mut.pid = c.pid LEFT JOIN msi ON msi.pid = c.pid\n" +
    "),\n" +
    "grp AS (\n" +
    (by
      ? "  SELECT " + pid + " AS pid, if(uniqExact(" + v + ") > 1, 'Multiple', any(trimBoth(attribute_value))) AS g\n" +
        "  FROM " + clinicalTable(db, [by]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(by) + " AND trimBoth(attribute_value) != ''\n" +
        "    AND " + inCohortClinical(study) + "\n" +
        "  GROUP BY pid\n"
      : "  SELECT DISTINCT pid, '' AS g FROM cohort\n") +
    ")"
  );
}
