// The adjusted view's SQL: what its runner (run.ts) asks each participant's database for.
// adjusted: each gene's alteration between two cohorts, by logistic regression on covariates
import { pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { driverJoin } from "../../federation.ts";
import { clinicalTable } from "../../custom-data.ts";

/**
 * One row per patient of the cohort with a mutation panel: the panels their samples were sequenced
 * on, the genes mutated in them (called mutations only; OncoKB drivers only with `driverPin`), and
 * each covariate's value as c0, c1, … (the patient's, or the first sample's). Values only: the
 * patient id joins the CTEs and is never returned. Run only through PatientLevelResolver.viewRows.
 */
export function adjustedRowsSql(cohortSql: string, study: string, db: string, o: { covariates: string[]; driverPin?: string | null }): string {
  const { covariates, driverPin = null } = o;
  for (const a of covariates) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study), sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "panels AS (\n" +
    "  SELECT " + sdPid + " AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + gPid + " AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driverPin ? driverJoin(driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'\n" +
    (driverPin ? "    AND ann.is_driver = 1\n" : "") +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")" +
    (covariates.length ?
      ",\nattrs AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      covariates.map((a, k) => "         argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(a) + ") AS a" + k).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, covariates) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + covariates.map(sq).join(",") + ") AND trimBoth(attribute_value) != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT panels.panels AS panels, mut.genes AS genes" + covariates.map((_, k) => ", attrs.a" + k + " AS c" + k).join("") + "\n" +
    "FROM panels\n" +
    "  LEFT JOIN mut ON mut.pid = panels.pid\n" +
    (covariates.length ? "  LEFT JOIN attrs ON attrs.pid = panels.pid\n" : "")
  );
}
