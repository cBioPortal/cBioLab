// The mutation table: one gene's mutations in a cohort, one row per mutation call, with the columns
// cBioPortal's Mutations tab lists. Its rows name samples, so — like the clinical table — the query
// lives here, outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.mutationRows: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";

export interface MutationColumn { id: string; name: string; numeric: boolean }

/** The table's columns, in the portal's order. */
export const MUTATION_COLUMNS: MutationColumn[] = [
  { id: "sample", name: "Sample ID", numeric: false },
  { id: "cancerType", name: "Cancer Type Detailed", numeric: false },
  { id: "proteinChange", name: "Protein Change", numeric: false },
  { id: "annotation", name: "Annotation (OncoKB)", numeric: false },
  { id: "mutationType", name: "Mutation Type", numeric: false },
  { id: "variantType", name: "Variant Type", numeric: false },
  { id: "vaf", name: "Allele Freq (T)", numeric: true },
  { id: "altCount", name: "Variant Reads", numeric: true },
  { id: "refCount", name: "Ref Reads", numeric: true },
  { id: "mutCount", name: "# Mut in Sample", numeric: true },
  { id: "chr", name: "Chromosome", numeric: false },
  { id: "start", name: "Start Pos", numeric: true },
  { id: "end", name: "End Pos", numeric: true },
  { id: "ref", name: "Ref", numeric: false },
  { id: "var", name: "Var", numeric: false },
  { id: "status", name: "MS", numeric: false },
];

export interface MutationSort { column: string; desc?: boolean }

/** How each sortable column orders in SQL; protein change orders by codon. */
const SORT_EXPR: Record<string, string> = {
  sample: "sid", cancerType: "cancerType", proteinChange: "pos", annotation: "drv", mutationType: "mutationType",
  variantType: "variantType", vaf: "vaf", altCount: "altCount", refCount: "refCount", mutCount: "mutCount",
  chr: "chr", start: "start", end: "end", ref: "ref", var: "var", status: "status",
};

/**
 * One gene's mutations in one cohort and study: a row per call (uncalled calls excluded, as the
 * portal excludes them), with the sample's detailed cancer type and mutation count where the study
 * records them, and the OncoKB call at `pin` when there is one. Sorted by `sort` — by default
 * drivers first, then by codon — then sample, so a download paged by `offset` is the order shown.
 */
export function mutationRowsSql(cohortSql: string, study: string, db: string, gene: string, pin: string | null,
  sort: MutationSort | null, limit: number, offset: number): string {
  const pre = sq(study + "_");
  const attr = (name: string, as: string) =>
    as + " AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, any(attribute_value) AS v FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(name) + "\n" +
    "    AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM m) GROUP BY sid)";
  const col = sort && SORT_EXPR[sort.column] ? SORT_EXPR[sort.column] : null;
  const order = col
    ? col + (sort!.desc ? " DESC" : " ASC") + " NULLS LAST, "
    : "drv DESC, pos ASC NULLS LAST, ";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "m AS (\n" +
    "  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,\n" +
    "         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos\n" +
    "  FROM " + db + ".mutation_derived\n" +
    "  WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n" +
    "    AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (pin
      ? "ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver\n" +
        "  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "  GROUP BY alteration),\n"
      : "") +
    attr("CANCER_TYPE_DETAILED", "ct") + ",\n" +
    attr("MUTATION_COUNT", "mc") + ",\n" +
    "rows AS (\n" +
    "  SELECT m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,\n" +
    (pin ? "         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,\n"
      : "         '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,\n") +
    "         m.mutationType AS mutationType, m.variantType AS variantType,\n" +
    "         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos\n" +
    "  FROM m\n" +
    (pin ? "  LEFT JOIN ann ON ann.alteration = m.proteinChange\n" : "") +
    "  LEFT JOIN ct ON ct.sid = m.sid LEFT JOIN mc ON mc.sid = m.sid\n" +
    ")\n" +
    "SELECT *, count() OVER () AS total FROM rows\n" +
    "ORDER BY " + order + "sid, proteinChange\n" +
    "LIMIT " + Math.max(0, Math.floor(limit)) + " OFFSET " + Math.max(0, Math.floor(offset))
  );
}
