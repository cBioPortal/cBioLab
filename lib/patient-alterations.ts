// The alterations view's tables: one patient's mutations, copy-number alterations and structural
// variants, with the columns cBioPortal's patient view lists for each, and the cohort's patients to
// choose from. Every row names a patient, so — like the mutation table — the queries live here,
// outside lib/federation*.ts's aggregate builders, and run only through PatientLevelResolver's
// rows* methods: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import type { TablePart } from "./mutation-table.ts";
import { patientSamplesSql } from "./patient-timeline.ts";

/** The view's three tables, in the portal's order. */
export const ALTERATION_TABLES = ["mutations", "cna", "sv"] as const;
export type AlterationTable = (typeof ALTERATION_TABLES)[number];
export const ALTERATION_TABLE_NAMES: Record<AlterationTable, string> = { mutations: "Mutations", cna: "Copy Number Alterations", sv: "Structural Variants" };

const str = (x: string) => "ifNull(toString(" + x + "), '')";
const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
const text = (id: string, name: string, expr = id): QueryColumn => ({ id, name, numeric: false, text: str(expr) });
const number = (id: string, name: string, expr = id): QueryColumn => ({ id, name, numeric: true, text: str(expr), num: num(expr) });
/** OncoKB's call as the table shows it, so search and the value list match what is on screen; ordered drivers first */
const annotation: QueryColumn = { id: "annotation", name: "Annotation (OncoKB)", numeric: false, order: "drv",
  text: "if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level ')))))" };
const samples = text("samples", "Samples");
/** the share of the study's samples profiled for the gene that carry the same kind of alteration in it, in percent */
const freq = number("freq", "Cohort %", "round(freq, 1)");

export const ALTERATION_COLUMNS: Record<AlterationTable, QueryColumn[]> = {
  mutations: [
    samples, text("gene", "Gene"), { ...text("proteinChange", "Protein Change"), order: "gene, pos" }, annotation,
    text("mutationType", "Mutation Type"), text("copy", "Copy #"), freq,
    number("vaf", "Allele Freq", "round(vaf, 2)"), number("altCount", "Variant Reads"), number("refCount", "Ref Reads"),
    text("variantType", "Variant Type"), text("chr", "Chromosome"), number("start", "Start Pos"), number("end", "End Pos"),
    text("ref", "Ref"), text("var", "Var"), text("status", "MS"),
  ],
  cna: [samples, text("gene", "Gene"), text("cna", "CNA"), annotation, text("cytoband", "Cytoband"), freq],
  sv: [
    samples, text("gene1", "Gene 1"), text("gene2", "Gene 2"), text("class", "Variant Class"), text("eventInfo", "Event Info"),
    text("breakpointType", "Breakpoint Type"), text("connectionType", "Connection Type"), text("frame", "Effect on Frame"),
    text("site1", "Site 1 Description"), text("site2", "Site 2 Description"),
    text("pos1", "Site 1 Position"), text("pos2", "Site 2 Position"), number("length", "Length"),
    number("tumorVariantCount", "Tumor Variant Count"), number("tumorReadCount", "Tumor Read Count"),
    text("dnaSupport", "DNA Support"), text("rnaSupport", "RNA Support"), text("status", "Status"), text("svAnnotation", "Study Annotation"), text("comments", "Comments"),
  ],
};

/** Shown unless the view names its columns: the portal's own default set for each table. */
export const ALTERATION_DEFAULT_COLUMNS: Record<AlterationTable, string[]> = {
  mutations: ["samples", "gene", "proteinChange", "annotation", "mutationType", "copy", "freq", "vaf"],
  cna: ["samples", "gene", "cna", "annotation", "cytoband", "freq"],
  sv: ["samples", "gene1", "gene2", "class", "eventInfo", "breakpointType", "connectionType"],
};

/** The patient list's columns: how much of each table a patient has, so a list can be sorted by it. */
export const ALTERATION_PATIENT_COLUMNS: QueryColumn[] = [
  { id: "patient", name: "Patient ID", numeric: false, text: "patient" },
  number("samples", "Samples"), number("mutations", "Mutations"), number("cna", "CNAs"), number("sv", "Structural Variants"),
];
export const ALTERATION_PATIENT_DEFAULT_COLUMNS = ["patient", "samples", "mutations", "cna", "sv"];

/** The patient's samples in their order (the numbered markers: lib/timeline-tracks.ts' sampleMarks), as an SQL array. */
const orderArray = (order: string[]) => order.length ? "[" + order.map(sq).join(", ") + "]" : "CAST([] AS Array(String))";
/** a sample's place in that order, from 1; a sample it does not name, last */
const ordinalOf = (order: string[], x: string) => "if(indexOf(" + orderArray(order) + ", " + x + ") = 0, 1000000, indexOf(" + orderArray(order) + ", " + x + "))";
/**
 * Over a group of a CTE's rows (`sid` a sample id): the Samples column — the ids in the patient's sample
 * order, joined — and `so`, the first of them's place in that order, which orders a gene's rows.
 */
const sampleCols = (order: string[]) =>
  "arrayStringConcat(arraySort(x -> " + ordinalOf(order, "x") + ", groupUniqArray(sid)), ', ') AS samples, min(" + ordinalOf(order, "sid") + ") AS so";

/** The study's samples profiled for each of `genesFrom`'s genes by `alterationType`'s profile. */
function profiledCte(name: string, db: string, study: string, alterationType: string, genesFrom: string): string {
  return name + " AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genesFrom + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(alterationType) + " GROUP BY gene),\n";
}

/** OncoKB's calls at `pin` for one alteration type and the genes `genesFrom` names. */
function oncokbCte(pin: string, type: "MUTATION" | "CNA", genesFrom: string): string {
  return "ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver\n" +
    "  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = " + sq(pin) + " AND alteration_type = '" + type + "' AND hugo_gene_symbol IN (" + genesFrom + ")\n" +
    "  GROUP BY gene, alteration),\n";
}
const annSelect = (pin: string | null) => pin
  ? "ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv"
  : "'' AS oncogenicity, '' AS level, toUInt8(0) AS drv";

/** The rows' labels: the part's cohort and study, the patient, and the first sample (the row's `sample`). */
const labels = (p: TablePart, patient: string) => sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, 0 AS ord, " + sq(patient) + " AS patient, splitByString(', ', g.samples)[1] AS sid";

/**
 * One patient's mutations, one row per variant however many of the patient's samples carry it (the
 * portal's patient table): the samples listed, the highest allele frequency among them with that
 * sample's reads, the gene's deep copy-number calls in the patient's samples (Copy #), and the share
 * of the study's samples profiled for the gene with any mutation in it (Cohort %). Uncalled calls are
 * left out, as the portal leaves them out. With no sort, a gene's rows sit together — genes with a
 * driver first, then by name — and within a gene by the first sample carrying the row (`order`, the
 * patient's sample order), then codon.
 */
export function patientMutationsSource(p: TablePart, patient: string, db: string, pin: string | null, order: string[]): RowSource {
  const st = sq(p.study), uid = sq(p.study + "_" + patient);
  return {
    with: "WITH m AS (\n" +
      "  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,\n" +
      "         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon,\n" +
      "         if(tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f\n" +
      "  FROM " + db + ".mutation_derived\n" +
      "  WHERE studyId = " + st + " AND patientId = " + sq(patient) + " AND molecularProfileId NOT LIKE '%uncalled%'\n" +
      "),\n" +
      "g AS (\n" +
      "  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, " + sampleCols(order) + ",\n" +
      "         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount\n" +
      "  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var\n" +
      "),\n" +
      (pin ? oncokbCte(pin, "MUTATION", "SELECT gene FROM g") : "") +
      "cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy\n" +
      "  FROM " + db + ".genomic_event_derived WHERE cancer_study_identifier = " + st + " AND patient_unique_id = " + uid + "\n" +
      "    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),\n" +
      "fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM " + db + ".genomic_event_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'\n" +
      "    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),\n" +
      profiledCte("fp", db, p.study, "MUTATION_EXTENDED", "SELECT gene FROM g") +
      "rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (\n" +
      "  SELECT " + labels(p, patient) + ", g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, " + annSelect(pin) + ",\n" +
      "         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,\n" +
      "         g.vaf AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,\n" +
      "         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos\n" +
      "  FROM g\n" +
      (pin ? "  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = g.proteinChange\n" : "") +
      "  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene\n" +
      "))\n",
    columns: ALTERATION_COLUMNS.mutations,
    select: "*",
    defaultOrder: "gdrv DESC, gene, so, pos ASC NULLS LAST",
    tiebreak: "gene, chr, start, end, ref, var, proteinChange, mutationType",
  };
}

/**
 * One patient's deep copy-number alterations (AMP, HOMDEL — the calls the portal's patient table
 * lists), one row per gene and call however many samples carry it, with the gene's cytoband and the
 * share of the study's samples profiled for the gene with the same call (Cohort %). With no sort,
 * genes with a driver call first, then by gene, then by the first sample carrying the call (`order`).
 */
export function patientCnaSource(p: TablePart, patient: string, db: string, pin: string | null, order: string[]): RowSource {
  const st = sq(p.study), pre = sq(p.study + "_"), uid = sq(p.study + "_" + patient);
  return {
    with: "WITH c AS (\n" +
      "  SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband\n" +
      "  FROM " + db + ".genomic_event_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND patient_unique_id = " + uid + " AND variant_type = 'cna' AND abs(cna_alteration) >= 2\n" +
      "),\n" +
      "g AS (SELECT gene, alt, any(cytoband) AS cytoband, " + sampleCols(order) + " FROM c GROUP BY gene, alt),\n" +
      (pin ? oncokbCte(pin, "CNA", "SELECT gene FROM g") : "") +
      "fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM " + db + ".genomic_event_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)\n" +
      "  GROUP BY gene, alt),\n" +
      profiledCte("fp", db, p.study, "COPY_NUMBER_ALTERATION", "SELECT gene FROM g") +
      "rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (\n" +
      "  SELECT " + labels(p, patient) + ", g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, " + annSelect(pin) + ",\n" +
      "         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq\n" +
      "  FROM g\n" +
      (pin ? "  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = if(g.alt > 0, 'AMPLIFICATION', 'DELETION')\n" : "") +
      "  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene\n" +
      "))\n",
    columns: ALTERATION_COLUMNS.cna,
    select: "*",
    defaultOrder: "gdrv DESC, gene, so",
    tiebreak: "gene, cna",
  };
}

/** The patient's samples' internal ids, for the tables keyed by them (structural variants). */
const patientSamples = (db: string, study: string, patient: string) =>
  "SELECT s.internal_id FROM " + db + ".sample s JOIN " + db + ".patient p ON p.internal_id = s.patient_id\n" +
  "    JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
  "    WHERE cs.cancer_study_identifier = " + sq(study) + " AND p.stable_id = " + sq(patient);

/**
 * One patient's structural variants, one row per event (both genes, both breakpoints, its class and
 * event info) however many samples carry it, with the study's own description of each site and the
 * highest supporting read counts among those samples. With no sort, by the first gene, then by the first
 * sample carrying the event (`order`), then the second gene.
 */
export function patientSvSource(p: TablePart, patient: string, db: string, order: string[]): RowSource {
  return {
    with: "WITH s AS (\n" +
      "  SELECT smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,\n" +
      "         ifNull(sv.class, '') AS class, ifNull(sv.event_info, '') AS eventInfo, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,\n" +
      "         sv.site2_effect_on_frame AS frame, sv.site1_description AS site1, sv.site2_description AS site2,\n" +
      "         if(sv.site1_position IS NULL, '', concat(ifNull(sv.site1_chromosome, ''), ':', toString(sv.site1_position))) AS pos1,\n" +
      "         if(sv.site2_position IS NULL, '', concat(ifNull(sv.site2_chromosome, ''), ':', toString(sv.site2_position))) AS pos2,\n" +
      "         sv.length AS length, sv.tumor_variant_count AS tumorVariantCount, sv.tumor_read_count AS tumorReadCount,\n" +
      "         sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport, sv.sv_status AS status, sv.annotation AS svAnnotation, sv.comments AS comments\n" +
      "  FROM " + db + ".structural_variant sv\n" +
      "  JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
      "  LEFT JOIN " + db + ".gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id\n" +
      "  LEFT JOIN " + db + ".gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id\n" +
      "  WHERE sv.sample_id IN (" + patientSamples(db, p.study, patient) + ")\n" +
      "),\n" +
      "g AS (\n" +
      "  SELECT gene1, gene2, class, eventInfo, pos1, pos2, " + sampleCols(order) + ",\n" +
      "         any(breakpointType) AS breakpointType, any(connectionType) AS connectionType, any(frame) AS frame, any(site1) AS site1, any(site2) AS site2,\n" +
      "         any(length) AS length, max(tumorVariantCount) AS tumorVariantCount, max(tumorReadCount) AS tumorReadCount,\n" +
      "         any(dnaSupport) AS dnaSupport, any(rnaSupport) AS rnaSupport, any(status) AS status, any(svAnnotation) AS svAnnotation, any(comments) AS comments\n" +
      "  FROM s GROUP BY gene1, gene2, class, eventInfo, pos1, pos2\n" +
      "),\n" +
      "rows AS (SELECT " + labels(p, patient) + ", g.* FROM g)\n",
    columns: ALTERATION_COLUMNS.sv,
    select: "*",
    defaultOrder: "gene1, so, gene2",
    tiebreak: "gene1, gene2, pos1, pos2, class, eventInfo",
  };
}

/** One patient's samples with their SAMPLE_TYPE — what numbers and colours the Samples column's markers. */
export const PATIENT_SAMPLE_COLUMNS: QueryColumn[] = [text("sid", "Sample ID"), text("type", "Sample Type")];
export function patientSamplesSource(p: TablePart, patient: string, db: string): RowSource {
  return {
    with: "WITH s AS (" + patientSamplesSql(p.study, patient, db) + "),\n" +
      "rows AS (SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, 0 AS ord, " + sq(patient) + " AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)\n",
    columns: PATIENT_SAMPLE_COLUMNS,
    select: "*",
    defaultOrder: "sid",
    tiebreak: "sid",
  };
}

/** A table's row source for one patient of `p`'s study. */
export function alterationSource(table: AlterationTable, p: TablePart, patient: string, db: string, pin: string | null, order: string[]): RowSource {
  return table === "mutations" ? patientMutationsSource(p, patient, db, pin, order) : table === "cna" ? patientCnaSource(p, patient, db, pin, order) : patientSvSource(p, patient, db, order);
}

/**
 * Every (cohort, study) part's patients, one row each, with how many samples they have and how many
 * rows each of the three tables would list for them — counted as the tables count (a variant, a
 * gene's call, an event, however many samples carry it). A patient with nothing called is listed:
 * the list is the cohort. Patients with any alteration first, then by patient id. All parts must
 * live in this database.
 */
export function alterationPatientRowSource(parts: TablePart[], db: string): RowSource {
  if (!parts.length) throw new Error("alterationPatientRowSource needs at least one part");
  const ctes: string[] = [], rows: string[] = [];
  parts.forEach((p, i) => {
    const st = sq(p.study), pre = sq(p.study + "_");
    ctes.push(
      "c" + i + " AS (" + p.cohortSql + "),\n" +
      "sm" + i + " AS (\n" +
      "  SELECT replaceOne(patient_unique_id, " + pre + ", '') AS pid, uniqExact(sample_unique_id) AS n FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND replaceOne(patient_unique_id, " + pre + ", '') IN (SELECT pid FROM c" + i + ")\n" +
      "  GROUP BY pid\n" +
      "),\n" +
      "mu" + i + " AS (\n" +
      "  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n\n" +
      "  FROM " + db + ".mutation_derived\n" +
      "  WHERE studyId = " + st + " AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c" + i + ")\n" +
      "  GROUP BY pid\n" +
      "),\n" +
      "cn" + i + " AS (\n" +
      "  SELECT replaceOne(patient_unique_id, " + pre + ", '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM " + db + ".genomic_event_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND variant_type = 'cna' AND abs(cna_alteration) >= 2\n" +
      "    AND replaceOne(patient_unique_id, " + pre + ", '') IN (SELECT pid FROM c" + i + ")\n" +
      "  GROUP BY pid\n" +
      "),\n" +
      "sv" + i + " AS (\n" +
      "  SELECT p.stable_id AS pid, uniqExact(tuple(sv.site1_entrez_gene_id, sv.site2_entrez_gene_id, sv.class, sv.event_info, sv.site1_chromosome, sv.site1_position, sv.site2_chromosome, sv.site2_position)) AS n\n" +
      "  FROM " + db + ".structural_variant sv\n" +
      "  JOIN " + db + ".sample s ON s.internal_id = sv.sample_id\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = s.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + st + " AND p.stable_id IN (SELECT pid FROM c" + i + ")\n" +
      "  GROUP BY pid\n" +
      "),\n");
    rows.push(
      "  SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, " + i + " AS ord, c.pid AS patient, '' AS sample,\n" +
      "         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv\n" +
      "  FROM (SELECT DISTINCT pid FROM c" + i + ") AS c\n" +
      "  LEFT JOIN sm" + i + " AS sm ON sm.pid = c.pid LEFT JOIN mu" + i + " AS mu ON mu.pid = c.pid\n" +
      "  LEFT JOIN cn" + i + " AS cn ON cn.pid = c.pid LEFT JOIN sv" + i + " AS sv ON sv.pid = c.pid\n");
  });
  return {
    with: "WITH " + ctes.join("") + "rows AS (\n" + rows.join("  UNION ALL\n") + ")\n",
    columns: ALTERATION_PATIENT_COLUMNS,
    select: "cohort, study, patient, sample, samples, mutations, cna, sv",
    defaultOrder: "mutations + cna + sv = 0, patient",
    tiebreak: "patient, ord",
  };
}
