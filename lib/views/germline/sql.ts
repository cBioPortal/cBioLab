// The germline view's SQL: what its runner (run.ts) asks each participant's database for.
import { pidOf, geneList } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { finiteSql } from "../../sql-number.ts";
import { clinicalTable } from "../../custom-data.ts";

/** Per gene: the cohort's patients with a germline call in it. Counts only. */
export function germCarriersSql(cohortSql: string, study: string, db: string): string {
  const gPid = pidOf("g.patient_unique_id", study);
  return "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT g.hugo_gene_symbol AS gene, uniqExact(" + gPid + ") AS carriers\n" +
    "FROM " + db + ".genomic_event_derived g\n" +
    "WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND " + GERMLINE + "\n" +
    "  AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY gene ORDER BY carriers DESC, gene LIMIT 500";
}

/**
 * Per gene and combination of: profiled for mutations (mp), a germline call (carrier), a somatic
 * mutation (som, any call not germline and not uncalled, on a covering panel), profiled for copy number
 * (cp) and a deep deletion (del): the number of patients. Carriers whose tumour panel does not list the
 * gene appear with mp = 0. Counts only.
 */
export function germCountsSql(cohortSql: string, study: string, db: string, genes: string[]): string {
  return germCtes(cohortSql, study, db, genes) + ",\n" +
    "fl AS (\n" +
    "  SELECT gene, toUInt8((pid, gene) IN (SELECT pid, gene FROM mprof)) AS mp, toUInt8((pid, gene) IN (SELECT pid, gene FROM germ)) AS carrier,\n" +
    "         toUInt8((pid, gene) IN (SELECT pid, gene FROM som)) AS som, toUInt8((pid, gene) IN (SELECT pid, gene FROM cprof)) AS cp,\n" +
    "         toUInt8((pid, gene) IN (SELECT pid, gene FROM del)) AS del\n" +
    "  FROM base\n" +
    ")\n" +
    "SELECT gene, mp, carrier, som, cp, del, count() AS n FROM fl GROUP BY gene, mp, carrier, som, cp, del";
}

/** Overall survival of the patients profiled for `gene`, by carrier status: counts of (carrier, months, dead). Counts only. */
export function germSurvivalSql(cohortSql: string, study: string, db: string, gene: string): string {
  const pid = pidOf("patient_unique_id", study);
  return germCtes(cohortSql, study, db, [gene]) + ",\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid, " + finiteSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "sv AS (\n" +
    "  SELECT toUInt8(mprof.pid IN (SELECT pid FROM germ)) AS carrier, os.months AS months, os.dead AS dead\n" +
    "  FROM mprof INNER JOIN os ON os.pid = mprof.pid WHERE os.months IS NOT NULL AND os.months >= 0\n" +
    ")\n" +
    "SELECT carrier, round(months, 2) AS t, dead, count() AS n FROM sv GROUP BY carrier, t, dead ORDER BY t";
}

// ---------------------------------------------------------------------------
// germline: carriers of a germline variant and their somatic second hits

export const GERMLINE = "lowerUTF8(trimBoth(g.mutation_status)) = 'germline'";

/** (patient, gene) pairs a panel of theirs covers for one alteration type (whole-exome covers all), over `genes`. */
function germProfiledCte(name: string, study: string, db: string, alterationType: string, list: string): string {
  const sdPid = pidOf("sd.patient_unique_id", study);
  return name + "p AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(alterationType) + " AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    name + " AS (\n" +
    "  SELECT DISTINCT x.pid AS pid, gp.gene AS gene FROM " + name + "p x JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = x.panel WHERE gp.gene IN (" + list + ")\n" +
    "  UNION DISTINCT\n" +
    "  SELECT pid, arrayJoin([" + list + "]) AS gene FROM " + name + "p WHERE panel = 'WES'\n" +
    ")";
}

function germCtes(cohortSql: string, study: string, db: string, genes: string[]): string {
  const gPid = pidOf("g.patient_unique_id", study), list = geneList(genes);
  const calls = (name: string, cond: string) => name + " AS (\n" +
    "  SELECT DISTINCT " + gPid + " AS pid, g.hugo_gene_symbol AS gene FROM " + db + ".genomic_event_derived g\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol IN (" + list + ") AND " + cond + "\n" +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    ")";
  return "WITH cohort AS (" + cohortSql + "),\n" +
    germProfiledCte("mprof", study, db, "MUTATION_EXTENDED", list) + ",\n" +
    germProfiledCte("cprof", study, db, "COPY_NUMBER_ALTERATION", list) + ",\n" +
    calls("germ", "g.variant_type = 'mutation' AND " + GERMLINE) + ",\n" +
    calls("som", "g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED' AND NOT (" + GERMLINE + ") AND NOT g.off_panel") + ",\n" +
    calls("del", "g.variant_type = 'cna' AND g.cna_alteration <= -2 AND NOT g.off_panel") + ",\n" +
    "base AS (SELECT pid, gene FROM mprof UNION DISTINCT SELECT pid, gene FROM germ)";
}
