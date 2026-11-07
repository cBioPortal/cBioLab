// The evolution view's tables: the cohort's patients that can be drawn, and one patient's mutations
// with their state in each of the patient's samples. Every row names a patient, so these are row
// sources (lib/table-query.ts), run only through PatientLevelResolver's rows* methods — a participant
// that may not disclose a patient has no such method.
import { mutationStudySql, sq } from "../../compiler.ts";
import { inCohortPatients } from "../../cohort2.ts";
import type { QueryColumn, RowSource } from "../../table-query.ts";
import type { TablePart } from "../../mutation-table.ts";

const str = (x: string) => "ifNull(toString(" + x + "), '')";
const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
const text = (id: string, name: string, expr = id): QueryColumn => ({ id, name, numeric: false, text: str(expr) });
const number = (id: string, name: string, expr = id): QueryColumn => ({ id, name, numeric: true, text: str(expr), num: num(expr) });

/**
 * A mutation's identity across samples, as the portal merges a patient's mutations
 * (generateMutationIdByGeneAndProteinChangeAndEvent): gene, protein change and the genomic event.
 */
const MUTATION_KEY = "concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', " +
  "toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, ''))";
/** the portal's uncalled mutations are a profile of their own; fusions recorded as mutations are left out, as the portal leaves them out */
const MUTATIONS_OF = (study: string, patientExpr: string) =>
  mutationStudySql(study) + " AND " + patientExpr + " AND ifNull(mutationType, '') != 'Fusion'";
const CALLED = "molecularProfileId NOT LIKE '%uncalled%'";
/** a mutation record with allele counts and variant reads: what makes a VAF to draw */
const HAS_VAF = "ifNull(tumorAltCount, 0) > 0 AND tumorRefCount IS NOT NULL AND tumorAltCount + tumorRefCount > 0";

/** The patient list's columns. */
export const EVOLUTION_PATIENT_COLUMNS: QueryColumn[] = [
  { id: "patient", name: "Patient ID", numeric: false, text: "patient" },
  number("samples", "Samples"), number("mutations", "Mutations"), number("withVaf", "Mutations with VAF"),
];
export const EVOLUTION_PATIENT_DEFAULT_COLUMNS = ["patient", "samples", "mutations", "withVaf"];

/**
 * Every (cohort, study) part's patients, one row each: how many samples they have, how many distinct
 * mutations were called in them, and how many of those have a VAF (variant reads, with reference
 * reads) in some sample. With `drawable`, only the patients the view can draw — two or more samples
 * and a mutation with a VAF, the portal's condition for showing its Genomic Evolution tab; without,
 * every patient (what says why one is left out). Most samples first, then by patient id.
 */
export function evolutionPatientsSource(parts: TablePart[], db: string, drawable = true): RowSource {
  if (!parts.length) throw new Error("evolutionPatientsSource needs at least one part");
  const ctes: string[] = [], rows: string[] = [];
  parts.forEach((p, i) => {
    const st = sq(p.study), pre = sq(p.study + "_");
    ctes.push(
      "c" + i + " AS (" + p.cohortSql + "),\n" +
      "sm" + i + " AS (\n" +
      "  SELECT replaceOne(patient_unique_id, " + pre + ", '') AS pid, uniqExact(sample_unique_id) AS n FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND " + inCohortPatients("replaceOne(patient_unique_id, " + pre + ", '')", "c" + i) + "\n" +
      "  GROUP BY pid\n" +
      "),\n" +
      "mu" + i + " AS (\n" +
      "  SELECT patientId AS pid, uniqExact(" + MUTATION_KEY + ") AS n, uniqExactIf(" + MUTATION_KEY + ", " + HAS_VAF + ") AS v\n" +
      "  FROM " + db + ".mutation_derived\n" +
      "  WHERE " + MUTATIONS_OF(p.study, inCohortPatients("patientId", "c" + i)) + " AND " + CALLED + "\n" +
      "  GROUP BY pid\n" +
      "),\n");
    rows.push(
      "  SELECT * FROM (SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, " + i + " AS ord, c.pid AS patient, '' AS sample,\n" +
      "         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(mu.v, 0)) AS withVaf\n" +
      "  FROM (SELECT DISTINCT pid FROM c" + i + ") AS c\n" +
      "  LEFT JOIN sm" + i + " AS sm ON sm.pid = c.pid LEFT JOIN mu" + i + " AS mu ON mu.pid = c.pid)" +
      (drawable ? " WHERE samples >= 2 AND withVaf > 0" : "") + "\n");
  });
  return {
    with: "WITH " + ctes.join("") + "rows AS (\n" + rows.join("  UNION ALL\n") + ")\n",
    columns: EVOLUTION_PATIENT_COLUMNS,
    select: "cohort, study, patient, sample, samples, mutations, withVaf",
    defaultOrder: "samples DESC, patient",
    tiebreak: "patient, ord",
  };
}

/** The mutation table's columns. `vafs` is the mutation in each sample, by the sample's number. */
export const EVOLUTION_COLUMNS: QueryColumn[] = [
  text("samples", "Samples"), text("gene", "Gene"), { ...text("proteinChange", "Protein Change"), order: "gene, pos" },
  text("mutationType", "Mutation Type"), text("vafs", "VAF by sample"), number("maxVaf", "Max VAF", "round(maxVaf, 3)"),
  number("called", "Samples called"),
  text("variantType", "Variant Type"), text("chr", "Chromosome"), number("start", "Start Pos"), number("end", "End Pos"),
  text("ref", "Ref"), text("var", "Var"),
];
export const EVOLUTION_DEFAULT_COLUMNS = ["samples", "gene", "proteinChange", "mutationType", "vafs", "maxVaf"];

/** The patient's samples in their order, as an SQL array, and a sample's place in it from 1 (one it does not name, last). */
const orderArray = (order: string[]) => order.length ? "[" + order.map(sq).join(", ") + "]" : "CAST([] AS Array(String))";
const ordinalOf = (order: string[], x: string) => "if(indexOf(" + orderArray(order) + ", " + x + ") = 0, 1000000, indexOf(" + orderArray(order) + ", " + x + "))";
/** a VAF with two decimals, as the table writes it */
const d2 = (x: string) => "toDecimalString(" + x + ", 2)";

/**
 * One patient's mutations, one row per mutation called in any of their samples, with its state in
 * every sample of the patient (`cells`, in the sample order `order`): called with allele counts,
 * called without, uncalled with variant reads (the study's uncalled-mutations profile), absent from
 * a sample sequenced for the gene (the sample's mutation panel covers it, or an uncalled record with
 * no variant reads says it was read), or NOT PROFILED (no panel covering the gene, or not sequenced
 * for mutations). `vafs` writes that out by sample number; `maxVaf` is the highest VAF among the
 * samples it was called in. With no sort: by the first sample it was called in, then the highest
 * VAF, then gene and codon — so a heatmap of the rows reads as the order mutations appear.
 */
export function evolutionMutationsSource(p: TablePart, patient: string, db: string, order: string[]): RowSource {
  const st = sq(p.study), pre = sq(p.study + "_"), uid = sq(p.study + "_" + patient);
  const isCall = "x.3 IN ('called', 'noVaf')";
  return {
    with: "WITH s AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND patient_unique_id = " + uid + "),\n" +
      // the panel each sample was sequenced with for mutations; a sample with none was not sequenced for them
      "pn AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, any(gene_panel_id) AS panel FROM " + db + ".sample_to_gene_panel_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM s) GROUP BY sid),\n" +
      "m AS (SELECT sampleId AS sid, " + MUTATION_KEY + " AS k, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr,\n" +
      "         startPosition AS start, endPosition AS end, referenceAllele AS ref, tumorSeqAllele AS var, proteinPosStart AS codon,\n" +
      "         tumorAltCount AS ac, tumorRefCount AS rc, toUInt8(" + CALLED + ") AS called\n" +
      "  FROM " + db + ".mutation_derived WHERE " + MUTATIONS_OF(p.study, "patientId = " + sq(patient)) + "),\n" +
      // a mutation is listed when it was called in some sample; an uncalled record only fills in another sample
      "g AS (SELECT k, any(gene) AS gene, any(proteinChange) AS proteinChange, any(mutationType) AS mutationType, any(variantType) AS variantType,\n" +
      "         any(chr) AS chr, any(start) AS start, any(end) AS end, any(ref) AS ref, any(var) AS var, min(codon) AS pos FROM m WHERE called = 1 GROUP BY k),\n" +
      // per mutation and sample: the called record when there is one, else the uncalled one
      "mm AS (SELECT k, sid, toUInt8(1) AS hit, max(called) AS cl, tupleElement(argMax(tuple(ac, rc), called), 1) AS mac, tupleElement(argMax(tuple(ac, rc), called), 2) AS mrc\n" +
      "  FROM m GROUP BY k, sid),\n" +
      "pc AS (SELECT pn.sid AS sid, pg.gene AS gene FROM pn JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = pn.panel WHERE pg.gene IN (SELECT gene FROM g)),\n" +
      "gs AS (SELECT g.k AS k, g.gene AS gene, s.sid AS sid, " + ordinalOf(order, "s.sid") + " AS o FROM g CROSS JOIN s),\n" +
      "cell AS (SELECT gs.k AS k, gs.sid AS sid, gs.o AS o, ifNull(mm.hit, 0) AS hit, ifNull(mm.cl, 0) AS cl, mm.mac AS ac, mm.mrc AS rc, ifNull(pc.sid, '') != '' AS cov\n" +
      "  FROM gs LEFT JOIN mm ON mm.k = gs.k AND mm.sid = gs.sid LEFT JOIN pc ON pc.sid = gs.sid AND pc.gene = gs.gene),\n" +
      "st AS (SELECT k, sid, o, ac, rc, ac IS NOT NULL AND rc IS NOT NULL AND ac + rc > 0 AS rd,\n" +
      "         multiIf(hit = 1 AND cl = 1, if(rd, 'called', 'noVaf'), hit = 1 AND rd AND ac > 0, 'uncalled', hit = 1 OR cov, 'absent', 'np') AS status,\n" +
      "         if(hit = 1 AND rd, ac / (ac + rc), NULL) AS f FROM cell),\n" +
      "a AS (SELECT k, arraySort(x -> x.1, groupArray(tuple(o, sid, status, f, ac, rc))) AS cells FROM st GROUP BY k),\n" +
      "rows AS (SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, 0 AS ord, " + sq(patient) + " AS patient,\n" +
      "         arrayFirst(x -> " + isCall + ", a.cells).2 AS sid, arrayFirst(x -> " + isCall + ", a.cells).1 AS so,\n" +
      "         arrayStringConcat(arrayMap(x -> x.2, arrayFilter(x -> " + isCall + ", a.cells)), ', ') AS samples,\n" +
      "         g.gene AS gene, g.proteinChange AS proteinChange, g.mutationType AS mutationType,\n" +
      "         arrayStringConcat(arrayMap(x -> concat(toString(x.1), ': ', multiIf(x.3 = 'called', " + d2("x.4") + ", x.3 = 'noVaf', 'called, no reads',\n" +
      "           x.3 = 'uncalled', concat(" + d2("x.4") + ", ' uncalled'), x.3 = 'absent', 'not found', 'not profiled')), a.cells), ' · ') AS vafs,\n" +
      "         if(arrayExists(x -> x.3 = 'called', a.cells), arrayMax(arrayMap(x -> ifNull(x.4, 0), arrayFilter(x -> x.3 = 'called', a.cells))), NULL) AS maxVaf,\n" +
      "         length(arrayFilter(x -> " + isCall + ", a.cells)) AS called,\n" +
      "         g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end, g.ref AS ref, g.var AS var, g.pos AS pos, a.cells AS cells\n" +
      "  FROM a JOIN g ON g.k = a.k)\n",
    columns: EVOLUTION_COLUMNS,
    select: "*",
    defaultOrder: "so, maxVaf DESC NULLS LAST, gene, pos ASC NULLS LAST",
    tiebreak: "gene, chr, start, end, ref, var, proteinChange",
  };
}

/** One patient's samples with the mutation panel each was sequenced with (none: not sequenced for mutations). */
export function evolutionSamplesSource(p: TablePart, patient: string, db: string): RowSource {
  const st = sq(p.study), pre = sq(p.study + "_");
  return {
    with: "WITH pn AS (SELECT sample_unique_id, any(gene_panel_id) AS panel FROM " + db + ".sample_to_gene_panel_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND alteration_type = 'MUTATION_EXTENDED' GROUP BY sample_unique_id),\n" +
      "rows AS (SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, 0 AS ord, " + sq(patient) + " AS patient,\n" +
      "         replaceOne(s.sample_unique_id, " + pre + ", '') AS sid, ifNull(pn.panel, '') AS panel\n" +
      "  FROM " + db + ".sample_derived s LEFT JOIN pn ON pn.sample_unique_id = s.sample_unique_id\n" +
      "  WHERE s.cancer_study_identifier = " + st + " AND s.patient_unique_id = " + sq(p.study + "_" + patient) + ")\n",
    columns: [text("sid", "Sample"), text("panel", "Mutation panel")],
    select: "*",
    defaultOrder: "sid",
    tiebreak: "sid",
  };
}
