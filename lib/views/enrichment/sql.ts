// The enrichment view's SQL: what its runner (run.ts) asks each participant's database for.
import { type EnrichAlteration, enrichEventCond, ENRICH_PANEL_TYPE } from "../../federation-views.ts";
import { driverJoin } from "../../federation.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";

/** Per gene: the cohort's samples with that alteration type in it (uncalled mutations excluded, as the
 *  portal's gene tables exclude them; high-level copy number only). Counts only. */
export function enrichAlteredSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration, pin: string | null, driver: boolean): AggregateSql {
  const sid = bareSampleId("g.sample_unique_id", study);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered\n" +
    "FROM " + db + ".genomic_event_derived g\n" +
    (driver && pin ? driverJoin(pin) : "") +
    "WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(alteration) + "\n" +
    "  AND " + inCohortSamples(sid) + (driver && pin ? " AND ann.is_driver" : "") + "\n" +
    "GROUP BY gene"
  ));
}

/** Per gene: the cohort's samples on a (non-WES) panel covering it for that alteration type — samples
 *  are counted per panel first and the panels then joined to their genes, Explore's own construction
 *  (distinct samples, never rows: a study with two CNA profiles lists each sample twice). */
export function enrichPanelProfiledSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration): AggregateSql {
  const covSid = bareSampleId("sp.sample_unique_id", study);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "pc AS (\n" +
    "  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[alteration]) + "\n" +
    "    AND sp.gene_panel_id != 'WES' AND " + inCohortSamples(covSid) + "\n" +
    "  GROUP BY panel\n" +
    ")\n" +
    "SELECT gptg.gene AS gene, sum(pc.n) AS profiled\n" +
    "FROM " + db + ".gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id\n" +
    "GROUP BY gene"
  ));
}

/** The cohort's whole-exome samples for that alteration type: profiled for every gene, so one number. */
export function enrichWesSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration): AggregateSql {
  const covSid = bareSampleId("sp.sample_unique_id", study);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT uniqExact(sp.sample_unique_id) AS n\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[alteration]) + "\n" +
    "  AND sp.gene_panel_id = 'WES' AND " + inCohortSamples(covSid)
  ));
}
