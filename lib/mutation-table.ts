// The mutation table: one gene's mutations in a cohort, one row per mutation call, with the columns
// cBioPortal's Mutations tab lists. Its rows name samples, so — like the clinical table — the query
// lives here, outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.rowsPage: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import { impactSql, impactType, canonicalType, cellOf, cellLabel, IMPACT_TYPES, IMPACT_COLORS } from "./lollipop.ts";
import { clinicalTable } from "./custom-data.ts";
import { inCohortSamples } from "./cohort2.ts";

export interface MutationColumn { id: string; name: string; numeric: boolean }

/** The table's columns, in the portal's order. */
export const MUTATION_COLUMNS: MutationColumn[] = [
  { id: "sample", name: "Sample ID", numeric: false },
  { id: "cancerType", name: "Cancer Type Detailed", numeric: false },
  { id: "proteinChange", name: "Protein Change", numeric: false },
  { id: "annotation", name: "Annotation (OncoKB)", numeric: false },
  { id: "mutationType", name: "Mutation Type", numeric: false },
  { id: "alteration", name: "Alteration", numeric: false },
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

/** Shown unless the view names its columns: the portal's own default set. */
export const MUTATION_DEFAULT_COLUMNS = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "mutCount"];

/**
 * The lollipop grid's cell a mutation falls in, spelled as the grid labels it ("Missense · Driver"):
 * its protein impact class (the lollipop's own mapping, lib/lollipop.ts) and driver status — every
 * mutation a driver when no OncoKB version is pinned, as the lollipop counts them then.
 */
export function alterationSql(pin: string | null): string {
  const klass = "transform(" + impactSql("mutationType") + ", [" + IMPACT_TYPES.map((k) => "'" + k + "'").join(", ") + "], [" +
    IMPACT_TYPES.map((k) => "'" + IMPACT_COLORS[k].label + "'").join(", ") + "], 'Other')";
  return "concat(" + klass + ", " + (pin ? "if(drv = 1, ' · Driver', ' · VUS')" : "' · Driver'") + ")";
}
/** The same, in the browser, for a row the table returned. */
export function alterationOf(mutationType: string, driver: boolean, pin: string | null): string {
  return cellLabel(cellOf(impactType(canonicalType(mutationType)), pin ? driver : true));
}

/** How each column reads off the rows: as text (search, text filters, value lists), as a number, and its order. */
function queryColumn(c: MutationColumn, pin: string | null): QueryColumn {
  const str = (x: string) => "ifNull(toString(" + x + "), '')";
  const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
  switch (c.id) {
    case "sample": return { ...c, text: "sid" };
    // spelled as the table shows it, so search and the value list match what is on screen
    case "annotation": return { ...c, text: "if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level ')))))", order: "drv" };
    case "proteinChange": return { ...c, text: str("proteinChange"), order: "pos" };
    case "alteration": return { ...c, text: alterationSql(pin) };
    case "vaf": return { ...c, text: str("round(vaf, 2)"), num: num("vaf") };
    default: return c.numeric ? { ...c, text: str(c.id), num: num(c.id) } : { ...c, text: str(c.id) };
  }
}

/** One (cohort, study) part of a table: the cohort's SQL as that study's resolver compiles it. */
export interface TablePart { cohort: string; study: string; cohortSql: string }

/** A part's rows, every column the table has, labelled with its cohort, study and document order. */
function partRows(p: TablePart, i: number, db: string, gene: string, pin: string | null): { ctes: string; rows: string } {
  const pre = sq(p.study + "_");
  const attr = (name: string, as: string) =>
    as + " AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, any(attribute_value) AS v FROM " + clinicalTable(db, [name]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(p.study) + " AND type = 'sample' AND attribute_name = " + sq(name) + "\n" +
    "    AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM m" + i + ") GROUP BY sid)";
  const ctes =
    "c" + i + " AS (" + p.cohortSql + "),\n" +
    "m" + i + " AS (\n" +
    "  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,\n" +
    "         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos\n" +
    "  FROM " + db + ".mutation_derived\n" +
    "  WHERE studyId = " + sq(p.study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n" +
    "    AND molecularProfileId NOT LIKE '%uncalled%' AND " + inCohortSamples("sampleId", "c" + i) + "\n" +
    "),\n" +
    attr("CANCER_TYPE_DETAILED", "ct" + i) + ",\n" +
    attr("MUTATION_COUNT", "mc" + i) + ",\n";
  const rows =
    "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,\n" +
    (pin ? "         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,\n"
      : "         '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,\n") +
    "         m.mutationType AS mutationType, m.variantType AS variantType,\n" +
    "         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos\n" +
    "  FROM m" + i + " AS m\n" +
    (pin ? "  LEFT JOIN ann ON ann.alteration = m.proteinChange\n" : "") +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = m.sid LEFT JOIN mc" + i + " AS mc ON mc.sid = m.sid\n";
  return { ctes, rows };
}

function allRows(parts: TablePart[], db: string, gene: string, pin: string | null): string {
  const built = parts.map((p, i) => partRows(p, i, db, gene, pin));
  return "WITH " +
    (pin
      ? "ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver\n" +
        "  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "  GROUP BY alteration),\n"
      : "") +
    built.map((b) => b.ctes).join("") +
    "rows AS (\n" + built.map((b) => b.rows).join("  UNION ALL\n") + ")\n";
}

/**
 * One gene's mutations across every (cohort, study) part a table spans, for lib/table-query.ts to
 * search, filter, sort and page in the database — so the order is global (studies interleave, as in
 * the portal's table) and any page is one query however deep. Uncalled calls are left out, as the
 * portal leaves them out; the sample's detailed cancer type and mutation count come from the
 * study's own attributes; the OncoKB call at `pin` when there is one. With no sort, drivers come
 * first, then by codon. All parts must live in the database this runs in.
 */
export function mutationRowSource(parts: TablePart[], db: string, gene: string, pin: string | null): RowSource {
  if (!parts.length) throw new Error("mutationRowSource needs at least one part");
  return {
    with: allRows(parts, db, gene, pin),
    columns: MUTATION_COLUMNS.map((c) => queryColumn(c, pin)),
    select: "*",
    defaultOrder: "drv DESC, pos ASC NULLS LAST",
    tiebreak: "sid, ord, proteinChange",
  };
}
