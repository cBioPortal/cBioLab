// The segments view's SQL. Its rows name samples, so neither builder is an aggregate: each returns
// a PatientSql that only PatientLevelResolver.viewRows runs (and neither is named *Sql, so the
// boundary suite's aggregate sweep does not take them for aggregate builders).
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { sq, mutationStudySql } from "../../compiler.ts";
import { patientSql, type PatientSql } from "../../sql-kinds.ts";
import { GENOME_CHROMS } from "../../federation-views.ts";

/** the chromosomes a segment may be drawn on: 1-22, X and Y, as IGV's whole-genome view draws them */
export const SEGMENT_CHROMS: string[] = [...GENOME_CHROMS, "Y"];

/** Where the view draws: every chromosome on the axis, or a stretch of one (1-based, inclusive). */
export interface SegmentRegion {
  /** the chromosomes the axis holds, in its order */
  axis: string[];
  /** a zoom: one chromosome and the stretch of it drawn */
  range?: { chrom: string; start: number; end: number };
}

export interface SegmentSamplesOpts extends SegmentRegion {
  sort: "order" | "gained" | "lost";
  /** rows returned at most (the view's row limit) */
  limit: number;
}

/** a segment's chromosome as the axis names it: 23/24 and "chr" prefixes folded as cBioPortal's importer writes them */
const CHROM = "multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', s.chr IN ('24', 'Y', 'chrY'), 'Y', replaceOne(s.chr, 'chr', ''))";

const arr = (xs: string[]) => "[" + xs.map(sq).join(",") + "]";
const int = (n: number) => { if (!Number.isSafeInteger(n)) throw new Error("not an integer position: " + n); return String(n); };

/** whether a segment row (chrom, st, en) is in the region, and how many of its bases are */
function inRegion(o: SegmentRegion): { cond: string; bases: string } {
  if (!o.range) return { cond: "has(" + arr(o.axis) + ", chrom)", bases: "(en - st + 1)" };
  const S = int(o.range.start), E = int(o.range.end);
  return { cond: "(chrom = " + sq(o.range.chrom) + " AND en >= " + S + " AND st <= " + E + ")",
    bases: "greatest(0, least(en, " + E + ") - greatest(st, " + S + ") + 1)" };
}

const studyId = (study: string, db: string) => "(SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")";

const samplesCte = (cohortSql: string, study: string, db: string, extra = "") =>
  "WITH cohort AS (" + cohortSql + "),\n" +
  "samp AS (\n" +
  "  SELECT internal_id AS sid, sample_stable_id AS sample, patient_stable_id AS patient, sample_type AS stype FROM " + db + ".sample_derived\n" +
  "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + extra + "\n" +
  "),\n" +
  "seg AS (\n" +
  "  SELECT s.sample_id AS sid, " + CHROM + " AS chrom, s.start AS st, s.end AS en, s.segment_mean AS m\n" +
  "  FROM " + db + ".copy_number_seg s\n" +
  "  WHERE s.cancer_study_id = " + studyId(study, db) + "\n" +
  "    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)\n" +
  ")\n";

/**
 * The cohort's samples that have any segment, one row each, in the view's order and cut to its row
 * limit: the sample and patient ids, the sample's segments in the region and on the whole genome, its mean over the region
 * (weighted by covered bases; null when nothing reaches it) and its segments off the axis; with,
 * on every row, the totals before the cut — how many samples have segments and how many segments lie
 * off the axis.
 */
export function segmentSamplesRows(cohortSql: string, study: string, db: string, o: SegmentSamplesOpts): PatientSql {
  const r = inRegion(o);
  const order = o.sort === "gained" ? "score DESC NULLS LAST, sid" : o.sort === "lost" ? "score ASC NULLS LAST, sid" : "sid";
  return patientSql(
    samplesCte(cohortSql, study, db) + ",\n" +
    "per AS (\n" +
    "  SELECT sid, countIf(" + r.cond + ") AS segs, countIf(has(" + arr(SEGMENT_CHROMS) + ", chrom)) AS allsegs, countIf(NOT has(" + arr(SEGMENT_CHROMS) + ", chrom)) AS other,\n" +
    "         sumIf(m * " + r.bases + ", " + r.cond + ") AS wsum, sumIf(" + r.bases + ", " + r.cond + ") AS wlen\n" +
    "  FROM seg GROUP BY sid\n" +
    ")\n" +
    "SELECT p.sid AS sid, samp.sample AS sample, samp.patient AS patient, samp.stype AS stype, p.segs AS segs, p.allsegs AS allSegs,\n" +
    "       if(p.wlen > 0, p.wsum / p.wlen, NULL) AS score,\n" +
    "       count() OVER () AS segmented, sum(p.other) OVER () AS otherChrom\n" +
    "FROM per p JOIN samp ON samp.sid = p.sid\n" +
    "ORDER BY " + order + "\n" +
    "LIMIT " + int(Math.max(1, Math.floor(o.limit))));
}

/** The segments in the region of the cohort's samples `sids` (internal ids from segmentSamplesRows), in axis order. */
export function segmentRows(cohortSql: string, study: string, db: string, o: SegmentRegion, sids: number[]): PatientSql {
  const r = inRegion(o);
  const ids = sids.length ? sids.map(int).join(",") : "-1";
  return patientSql(
    samplesCte(cohortSql, study, db, " AND internal_id IN (" + ids + ")") +
    "SELECT sid, indexOf(" + arr(o.axis) + ", chrom) - 1 AS c, st, en, m FROM seg\n" +
    "WHERE " + r.cond + "\n" +
    "ORDER BY sid, c, st, en");
}

/**
 * The genomic overview's mutations (the patient page): every called mutation of the cohort's
 * samples, with its sample's internal id, patient and type (so a sample with mutations but no
 * segments still gets a row), position, gene, protein change and mutation type — what the portal's
 * patient view draws on its IGV mutation track.
 */
export function overviewMutationRows(cohortSql: string, study: string, db: string): PatientSql {
  return patientSql(
    samplesCte(cohortSql, study, db) +
    "SELECT samp.sid AS sid, samp.sample AS sample, samp.patient AS patient, samp.stype AS stype,\n" +
    "       " + CHROM.replace(/s\.chr/g, "m.chr") + " AS chrom, m.startPosition AS st, m.endPosition AS en,\n" +
    "       m.`GENE.hugoGeneSymbol` AS gene, m.proteinChange AS change, m.mutationType AS mtype\n" +
    "FROM " + db + ".mutation_derived m JOIN samp ON samp.sample = m.sampleId\n" +
    "WHERE " + mutationStudySql(study) + " AND m.molecularProfileId NOT LIKE '%uncalled%'\n" +
    "ORDER BY sid, chrom, st, gene");
}

/** Each of the cohort's samples' gene panels for mutations and for copy number ('WES' where none is recorded). */
export function overviewPanelRows(cohortSql: string, study: string, db: string): PatientSql {
  return patientSql(
    samplesCte(cohortSql, study, db) +
    "SELECT samp.sample AS sample, sp.alteration_type AS type, toString(sp.gene_panel_id) AS panel\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp JOIN samp ON concat(" + sq(study + "_") + ", samp.sample) = sp.sample_unique_id\n" +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type IN ('MUTATION_EXTENDED', 'COPY_NUMBER_ALTERATION')\n" +
    "ORDER BY sample, type");
}
