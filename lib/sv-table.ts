// The structural-variant table: every structural variant in a cohort's samples that involves one
// of the queried genes as either partner, one row per call, with the columns cBioPortal's Results
// View "Structural Variants" tab lists. Its rows name samples, so — like the mutation table — the
// query lives here, outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.rowsPage: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import type { TablePart } from "./mutation-table.ts";
import { clinicalTable } from "./custom-data.ts";
import { inCohortSamples } from "./cohort2.ts";

const str = (x: string) => "ifNull(toString(" + x + "), '')";
const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
const text = (id: string, name: string): QueryColumn => ({ id, name, numeric: false, text: str(id) });
const number = (id: string, name: string): QueryColumn => ({ id, name, numeric: true, text: str(id), num: num(id) });

/**
 * The table's columns, in the portal's order (StructuralVariantTable's FusionTableColumnType, the
 * Results View's column list), with its names. Left out: the two Exon/Intron columns (the portal
 * computes them from Genome Nexus transcripts, which this app does not read) and Center (not stored).
 */
export const SV_COLUMNS: QueryColumn[] = [
  text("study", "Study"),
  { id: "sample", name: "Sample ID", numeric: false, text: "sid" },
  text("cancerType", "Cancer Type Detailed"),
  text("gene1", "Gene 1"), text("site1Entrez", "Site1 Entrez Gene Id"), text("site1Transcript", "Site1 Ensembl Transcript Id"),
  text("site1Chr", "Site1 Chromosome"), number("site1Pos", "Site1 Position"), text("site1Desc", "Site1 Description"),
  text("gene2", "Gene 2"), text("site2Entrez", "Site2 Entrez Gene Id"), text("site2Transcript", "Site2 Ensembl Transcript Id"),
  text("site2Chr", "Site2 Chromosome"), number("site2Pos", "Site2 Position"), text("site2Desc", "Site2 Description"),
  text("frame", "Effect on Frame"),
  // OncoKB's call as the table shows it, so search and the value list match what is on screen; ordered drivers first
  { id: "annotation", name: "Annotation (OncoKB)", numeric: false, order: "drv",
    text: "if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level ')))))" },
  text("status", "MS"), text("ncbiBuild", "NCBI Build"), text("dnaSupport", "DNA Support"), text("rnaSupport", "RNA Support"),
  number("normalReadCount", "Normal Read Count"), number("tumorReadCount", "Tumor Read Count"),
  number("normalVariantCount", "Normal Variant Count"), number("tumorVariantCount", "Tumor Variant Count"),
  number("normalPairedEndReadCount", "Normal Paired End Read Count"), number("tumorPairedEndReadCount", "Tumor Paired End Read Count"),
  number("normalSplitReadCount", "Normal Split Read Count"), number("tumorSplitReadCount", "Tumor Split Read Count"),
  text("svDescription", "SV Description"), text("breakpointType", "Breakpoint Type"), text("connectionType", "Connection Type"),
  text("eventInfo", "Event Info"), text("class", "Variant Class"), number("length", "Length"), text("comments", "Comments"),
];

/** Shown unless the view names its columns: the portal's own default set, in the order its tab shows them. */
export const SV_DEFAULT_COLUMNS = ["sample", "cancerType", "gene1", "gene2", "annotation", "connectionType", "eventInfo", "class"];

/** The queried genes' Entrez ids, as the portal asks for structural variants (fetchStructuralVariantsUsingPOST's entrezGeneIds). */
const entrezOf = (db: string, genes: string[]) =>
  "SELECT entrez_gene_id FROM " + db + ".gene WHERE hugo_gene_symbol IN (" + genes.map(sq).join(", ") + ")";

/** A part's rows, every column the table has, labelled with its cohort, study and document order. */
function partRows(p: TablePart, i: number, db: string, genes: string[], pin: string | null): { ctes: string; rows: string } {
  const pre = sq(p.study + "_");
  const ctes =
    "c" + i + " AS (" + p.cohortSql + "),\n" +
    "s" + i + " AS (\n" +
    "  SELECT sv.internal_id AS svid, pt.stable_id AS pid, smp.stable_id AS sid,\n" +
    "         ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,\n" +
    "         sv.site1_entrez_gene_id AS site1Entrez, sv.site1_ensembl_transcript_id AS site1Transcript, sv.site1_chromosome AS site1Chr,\n" +
    "         sv.site1_position AS site1Pos, sv.site1_description AS site1Desc,\n" +
    "         sv.site2_entrez_gene_id AS site2Entrez, sv.site2_ensembl_transcript_id AS site2Transcript, sv.site2_chromosome AS site2Chr,\n" +
    "         sv.site2_position AS site2Pos, sv.site2_description AS site2Desc, sv.site2_effect_on_frame AS frame,\n" +
    "         sv.sv_status AS status, sv.ncbi_build AS ncbiBuild, sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport,\n" +
    "         sv.normal_read_count AS normalReadCount, sv.tumor_read_count AS tumorReadCount,\n" +
    "         sv.normal_variant_count AS normalVariantCount, sv.tumor_variant_count AS tumorVariantCount,\n" +
    "         sv.normal_paired_end_read_count AS normalPairedEndReadCount, sv.tumor_paired_end_read_count AS tumorPairedEndReadCount,\n" +
    "         sv.normal_split_read_count AS normalSplitReadCount, sv.tumor_split_read_count AS tumorSplitReadCount,\n" +
    "         sv.annotation AS svDescription, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,\n" +
    "         sv.event_info AS eventInfo, sv.class AS class, sv.length AS length, sv.comments AS comments\n" +
    "  FROM " + db + ".structural_variant sv\n" +
    "  JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
    "  JOIN " + db + ".patient pt ON pt.internal_id = smp.patient_id\n" +
    "  LEFT JOIN " + db + ".gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id\n" +
    "  LEFT JOIN " + db + ".gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(p.study) + " AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'\n" +
    "    AND (sv.site1_entrez_gene_id IN (" + entrezOf(db, genes) + ") OR sv.site2_entrez_gene_id IN (" + entrezOf(db, genes) + "))\n" +
    "    AND " + inCohortSamples("smp.stable_id", "c" + i) + "\n" +
    "),\n" +
    "ct" + i + " AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, any(attribute_value) AS v FROM " + clinicalTable(db, ["CANCER_TYPE_DETAILED"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(p.study) + " AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'\n" +
    "    AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM s" + i + ") GROUP BY sid),\n";
  // the stronger of the two partners' calls: a driver before a non-driver, gene 1 when they tie
  const pick = (f: string) => "if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2." + f + ", a1." + f + ")";
  const rows =
    "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         s.pid AS patient, s.sid AS sid, ifNull(ct.v, '') AS cancerType,\n" +
    (pin ? "         " + pick("oncogenicity") + " AS oncogenicity, " + pick("level") + " AS level, toUInt8(greatest(a1.driver, a2.driver)) AS drv,\n"
      : "         '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,\n") +
    "         s.* EXCEPT (pid, sid)\n" +
    "  FROM s" + i + " AS s\n" +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = s.sid\n" +
    (pin ? "  LEFT JOIN ann AS a1 ON a1.gene = s.gene1 AND s.gene1 != '' LEFT JOIN ann AS a2 ON a2.gene = s.gene2 AND s.gene2 != ''\n" : "");
  return { ctes, rows };
}

function allRows(parts: TablePart[], db: string, genes: string[], pin: string | null): string {
  const built = parts.map((p, i) => partRows(p, i, db, genes, pin));
  return "WITH " +
    (pin
      // the store keys a structural variant by gene, as alteration 'Fusion' (lib/oql.ts's storeAlteration)
      ? "ann AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver\n" +
        "  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'SV' AND alteration = 'Fusion'\n" +
        "  GROUP BY gene),\n"
      : "") +
    built.map((b) => b.ctes).join("") +
    "rows AS (\n" + built.map((b) => b.rows).join("  UNION ALL\n") + ")\n";
}

/**
 * The structural variants of `genes` across every (cohort, study) part a table spans — a call is
 * listed when either partner is one of them, once however many of them it involves — for
 * lib/table-query.ts to search, filter, sort and page in the database. One row per call, as the
 * portal lists them: a patient with several samples carrying the same event has a row for each.
 * Only the study's structural-variant profile is read, and only the cohort's samples. With no
 * sort, drivers first (when an OncoKB version is pinned), then by gene 1, gene 2 and sample. All
 * parts must live in the database this runs in.
 */
export function svRowSource(parts: TablePart[], db: string, genes: string[], pin: string | null): RowSource {
  if (!parts.length) throw new Error("svRowSource needs at least one part");
  if (!genes.length) throw new Error("svRowSource needs at least one gene");
  return {
    with: allRows(parts, db, genes, pin),
    columns: SV_COLUMNS,
    select: "*",
    defaultOrder: "drv DESC, gene1, gene2",
    tiebreak: "sid, ord, svid",
  };
}
