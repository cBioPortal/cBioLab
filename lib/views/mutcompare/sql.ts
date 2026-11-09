// The mutcompare view's SQL: what its runner (run.ts) asks each participant's database for, beyond the
// lollipop's counts (lib/federation.ts lollipopCounts) and the ranking's (lib/federation-views.ts enrich*).
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { bareSampleId } from "../../cohort2.ts";

/**
 * The cohort's patients with a sample profiled for mutations in one gene — on a panel listing it, or
 * whole-exome — the denominator of every share the portal's Mutations tab shows (its
 * groupToProfiledPatients). One number leaves.
 */
export function mutcompareProfiledSql(cohortSql: string, study: string, db: string, gene: string): AggregateSql {
  const sid = bareSampleId("sp.sample_unique_id", study);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT uniqExact(c.pid) AS n\n" +
    "FROM cohort c\n" +
    "WHERE c.sid IN (\n" +
    "  SELECT " + sid + " FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (SELECT gene_panel_id FROM " + db + ".gene_panel_to_gene_derived WHERE gene = " + sq(gene) + "))\n" +
    ")"
  ));
}
