// The drivernegative view's SQL: what its runner (run.ts) asks each participant's database for.
import { type EnrichAlteration, pidOf, enrichEventCond, geneList, ENRICH_PANEL_TYPE } from "../../federation-views.ts";
import { driverJoin } from "../../federation.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Patients per group (positive, negative, unprofiled), of the cohort's patients sequenced for mutations. Counts only. */
export function dnegGroupsSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[]): AggregateSql {
  return aggregateSql(dnegCtes(cohortSql, study, db, pin, drivers, "mutation") + "\nSELECT g AS grp, count() AS n FROM grp GROUP BY grp");
}

/** Per gene outside `drivers` and per group (positive, negative): patients with that alteration in it
 *  (OncoKB drivers only with `driverOnly`). Counts only. */
export function dnegAlteredSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[], alteration: EnrichAlteration, driverOnly: boolean): AggregateSql {
  const gPid = pidOf("g.patient_unique_id", study);
  return aggregateSql((
    dnegCtes(cohortSql, study, db, pin, drivers, alteration) + "\n" +
    "SELECT g.hugo_gene_symbol AS gene, grp.g AS grp, uniqExact(" + gPid + ") AS altered\n" +
    "FROM " + db + ".genomic_event_derived g\n" + (driverOnly ? driverJoin(pin) : "") +
    "  INNER JOIN grp ON grp.pid = " + gPid + "\n" +
    "WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(alteration) + "\n" +
    "  AND g.hugo_gene_symbol NOT IN (" + geneList(drivers) + ") AND grp.g IN ('positive', 'negative')" + (driverOnly ? " AND ann.is_driver" : "") + "\n" +
    "GROUP BY gene, grp"
  ));
}

/** Per gene and group: patients not on whole-exome with a panel covering the gene for that alteration
 *  type; gene '' carries each group's whole-exome patients, profiled for every gene. Counts only. */
export function dnegProfiledSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[], alteration: EnrichAlteration): AggregateSql {
  return aggregateSql((
    dnegCtes(cohortSql, study, db, pin, drivers, alteration) + ",\n" +
    "pw AS (SELECT pid, max(panel = 'WES') AS wes FROM pp GROUP BY pid)\n" +
    "SELECT if(pw.wes = 1, '', gp.gene) AS gene, grp.g AS grp, uniqExact(pp.pid) AS profiled\n" +
    "FROM pp INNER JOIN pw ON pw.pid = pp.pid INNER JOIN grp ON grp.pid = pp.pid\n" +
    "  LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel\n" +
    "WHERE grp.g IN ('positive', 'negative')\n" +
    "GROUP BY gene, grp"
  ));
}

/**
 * Each sequenced patient's group: "positive" with an OncoKB driver (mutation, high-level copy
 * number or structural variant) in one of `drivers`; else "negative" when a mutation panel of
 * theirs covers every listed gene (or whole-exome); else "unprofiled". With `type`, also `pp`:
 * each patient's panels for that alteration type and whether one is whole-exome.
 */
function dnegCtes(cohortSql: string, study: string, db: string, pin: string, drivers: string[], type: EnrichAlteration): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study), list = geneList(drivers);
  const panelsOf = (name: string, alterationType: string) => name + " AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(alterationType) + "\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    ")";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    panelsOf("mp", "MUTATION_EXTENDED") + ",\n" +
    panelsOf("pp", ENRICH_PANEL_TYPE[type]) + ",\n" +
    "cov AS (\n" +
    "  SELECT mp.pid AS pid, max(mp.panel = 'WES') AS wes, uniqExactIf(gp.gene, gp.gene IN (" + list + ")) AS ng\n" +
    "  FROM mp LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = mp.panel\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "drv AS (\n" +
    "  SELECT DISTINCT " + gPid + " AS pid\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + driverJoin(pin) +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol IN (" + list + ") AND ann.is_driver\n" +
    "    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')\n" +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "grp AS (\n" +
    "  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = " + new Set(drivers).size + ", 'negative', 'unprofiled') AS g FROM cov\n" +
    ")"
  );
}
