// The pathwaymap view's own SQL: a query gene's altered count where its line carries OQL (run.ts
// asks it through the resolvers' viewAggregate; every other gene's counts are the resolvers' geneCounts).
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { sq } from "../../compiler.ts";
import { oqlEventsSql, parseOql, type OqlPins, type OqlDriverOpts } from "../../oql.ts";
import { hasOql } from "../../oql-match.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** how the lines read: the study's pin and profiles, the page's driver settings and EXP / PROT profiles */
export interface PathwayOql extends OqlDriverOpts { oncokbPin?: string | null; profiles?: string[]; pins?: OqlPins }

/**
 * Per gene of the lines that carry OQL: the cohort's samples its lines (together) match and that
 * are profiled for the gene in some data type — the portal's query-gene node, its line's
 * OQL-filtered data (ResultsViewPathwayMapper alterationFrequencyDataForQueryGenes). Counts only.
 */
export function lineCountsSql(cohortSql: string, study: string, db: string, lines: string[], oql: PathwayOql): AggregateSql {
  const byGene = new Map<string, string[]>();
  for (const line of lines) for (const e of parseOql(line))
    if (hasOql(e.specs)) byGene.set(e.gene, [...(byGene.get(e.gene) || []), line]);
  const genes = [...byGene.keys()];
  const covSid = bareSampleId("sp.sample_unique_id", study);
  const matched = genes.map((g) =>
    "  SELECT " + sq(g) + " AS gene, e.sid AS sid FROM (" + oqlEventsSql(byGene.get(g)!.join("; "), { ...oql, study, db }) + ") e\n" +
    "  WHERE " + inCohortSamples("e.sid"));
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "matched AS (\n" + (matched.length ? matched.join("\n  UNION ALL\n") : "  SELECT '' AS gene, '' AS sid WHERE 0") + "\n),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covSid + " AS sid FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + (genes.length ? genes.map(sq).join(",") : "''") + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND " + inCohortSamples(covSid) + "\n" +
    ")\n" +
    "SELECT gene, uniqExact(sid) AS altered FROM matched WHERE (gene, sid) IN (SELECT gene, sid FROM covered) GROUP BY gene"
  ));
}
