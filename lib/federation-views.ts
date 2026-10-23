// Aggregate SQL behind the view kinds in lib/views/ that query through a resolver's viewAggregate,
// viewAggregateMany and viewMeta (genome, pathways, enrichment, …). Same rules as every builder in
// lib/federation.ts, which re-exports these so test/boundary.test.ts sweeps them with the rest:
// the outer SELECT returns counts, sums and grouping keys — never an identifier — so any
// participant, aggregate-only included, can answer.
import { sq } from "./compiler.ts";
import { ALTERED_COND, driverJoin } from "./federation.ts";
import { clinicalValueFoldSql, nameFoldSql, foldedEqualsSql, foldedInSql } from "./event-names.ts";
import { clinicalTable } from "./custom-data.ts";
import { splitBucketSql } from "./cohort2.ts";
import { casesCte, type CompositionSource } from "./composition.ts";
import { finiteSql } from "./sql-number.ts";
import { linesCtes, type LineSpec } from "./treatment-lines.ts";

/** bare patient id for a *_unique_id column of this study */
const pidOf = (col: string, study: string): string => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";

// ---------------------------------------------------------------------------
// genome: copy-number segments, binned along the genome

/** Autosomes in order, then X. Y is never drawn: its log ratio mostly records sex, not tumour. */
export const GENOME_CHROMS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
  "17", "18", "19", "20", "21", "22", "X"] as const;

/** Chromosome lengths (bp), UCSC hg19 and hg38 chromInfo. */
export const CHROM_LENGTHS: Record<"hg19" | "hg38", Record<string, number>> = {
  hg19: { "1": 249250621, "2": 243199373, "3": 198022430, "4": 191154276, "5": 180915260, "6": 171115067,
    "7": 159138663, "8": 146364022, "9": 141213431, "10": 135534747, "11": 135006516, "12": 133851895,
    "13": 115169878, "14": 107349540, "15": 102531392, "16": 90354753, "17": 81195210, "18": 78077248,
    "19": 59128983, "20": 63025520, "21": 48129895, "22": 51304566, "X": 155270560 },
  hg38: { "1": 248956422, "2": 242193529, "3": 198295559, "4": 190214555, "5": 181538259, "6": 170805979,
    "7": 159345973, "8": 145138636, "9": 138394717, "10": 133797422, "11": 135086622, "12": 133275309,
    "13": 114364328, "14": 107043718, "15": 101991189, "16": 90338345, "17": 83257441, "18": 80373285,
    "19": 58617616, "20": 64444167, "21": 46709983, "22": 50818468, "X": 156040895 }
};

/** The study's reference genome, from its own metadata. Metadata only. */
export function studyGenomeSql(study: string, db: string): string {
  return "SELECT rg.name AS build FROM " + db + ".cancer_study cs\n" +
    "JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study);
}

export interface GenomeBinOpts {
  /** bin width in base pairs */
  binBp: number;
  /** |segment mean| at or past this is a gain / loss (log2 ratio) */
  threshold: number;
  includeX: boolean;
}

/**
 * The cohort's segmented SAMPLES, one row per (chromosome, bin): how many have a segment
 * covering that bin's midpoint (the bin's own denominator — a sample whose segmentation does
 * not reach a bin was not measured there, which is not the same as copy-neutral), and how many
 * of those are gained or lost there.
 *
 * Each bin takes the value of the segment covering its MIDPOINT, so a focal event narrower than
 * a bin can fall between midpoints and be missed; the caller says so and a smaller bin finds it.
 * A sample with overlapping segments at one midpoint (it happens in a few studies' files) takes
 * their mean, so it is still counted once.
 */
export function genomeBinsSql(cohortSql: string, study: string, db: string, o: GenomeBinOpts): string {
  const B = Math.max(1, Math.floor(o.binBp)), half = Math.floor(B / 2), T = Number(o.threshold);
  const chroms = GENOME_CHROMS.filter((c) => o.includeX || c !== "X");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "seg AS (\n" +
    "  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,\n" +
    "         s.start AS st, s.end AS en, s.segment_mean AS m\n" +
    "  FROM " + db + ".copy_number_seg s\n" +
    "  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)\n" +
    "),\n" +
    "binned AS (\n" +
    "  SELECT sid, chrom, bin, avg(m) AS v FROM (\n" +
    "    SELECT sid, chrom, m,\n" +
    "           arrayJoin(range(toUInt64(greatest(0, ceil((st - " + half + ") / " + B + "))),\n" +
    "                           toUInt64(greatest(0, floor((en - " + half + ") / " + B + ") + 1)))) AS bin\n" +
    "    FROM seg WHERE chrom IN (" + chroms.map(sq).join(",") + ") AND en >= st\n" +
    "  ) GROUP BY sid, chrom, bin\n" +
    ")\n" +
    "SELECT chrom, bin, count() AS profiled, countIf(v >= " + T + ") AS gain, countIf(v <= " + (-T) + ") AS loss\n" +
    "FROM binned GROUP BY chrom, bin ORDER BY chrom, bin"
  );
}

/** How many of the cohort's samples exist, and how many have any segment at all. */
export function genomeCoverageSql(cohortSql: string, study: string, db: string): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    ")\n" +
    "SELECT (SELECT count() FROM samp) AS samples,\n" +
    "       (SELECT uniqExact(sample_id) FROM " + db + ".copy_number_seg\n" +
    "         WHERE cancer_study_id = (SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "           AND sample_id IN (SELECT sid FROM samp)) AS segmented\n" +
    "FROM system.one"
  );
}

// ---------------------------------------------------------------------------
// pathways: is ANY gene of a set altered?

/**
 * Per gene SET, for one cohort in one study: patients profiled for at least one member (any
 * alteration type), altered in at least one member, and carrying a driver in at least one
 * member — the oncoprint's merged-row rule, so a set's percentage is over the UNION of its
 * members' panels. Built from exactly the CTEs geneCountsSql uses (same event table, the same
 * high-level-CNA rule, the same driver join, the same panel coverage), so a one-gene set gives
 * that gene's own 'any' counts.
 */
export function geneSetCountsSql(cohortSql: string, sets: { name: string; genes: string[] }[], study: string,
  pin: string | null, db: string): string {
  const genes = [...new Set(sets.flatMap((x) => x.genes))];
  const geneList = genes.map(sq).join(",");
  const pairs = sets.flatMap((x) => x.genes.map((g) => "(" + sq(x.name) + "," + sq(g) + ")")).join(",");
  const pid = pidOf("g.patient_unique_id", study), covPid = pidOf("sd.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "members AS (SELECT tupleElement(m, 1) AS set_name, tupleElement(m, 2) AS gene FROM (SELECT arrayJoin([" + pairs + "]) AS m)),\n" +
    "altered AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, " + pid + " AS pid,\n" +
    (pin ? "         max(ann.is_driver) AS is_driver\n" : "         0 AS is_driver\n") +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY gene, pid\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covPid + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT members.set_name AS set_name, x.pid AS pid, max(x.is_alt) AS is_alt, max(x.is_drv) AS is_drv\n" +
    "  FROM (\n" +
    "    SELECT gene, pid, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered\n" +
    "    UNION ALL\n" +
    "    SELECT gene, pid, 0 AS is_alt, 0 AS is_drv FROM covered\n" +
    "  ) x\n" +
    "  INNER JOIN members ON members.gene = x.gene\n" +
    "  GROUP BY set_name, pid\n" +
    ")\n" +
    "SELECT set_name, uniqExact(pid) AS profiled, uniqExactIf(pid, is_alt = 1) AS altered, uniqExactIf(pid, is_drv = 1) AS driver\n" +
    "FROM per GROUP BY set_name"
  );
}

// ---------------------------------------------------------------------------
// diffexpr: every gene's moments on one molecular profile

/**
 * Per GENE, over the cohort's patients: n, Σv and Σv² of the patient's value (the mean of their
 * samples', as profileMomentsSql takes it), on the profile as stored or as log2(v + 1). Three
 * additive totals per gene are all Welch's t needs, so a site sends no value at all, and every
 * gene in the profile comes back — a ranking for enrichment needs the whole list, not a
 * shortlist. A negative stored value under log2 has no meaning and is left out, never clamped.
 */
export function profileMomentsAllSql(cohortSql: string, study: string, db: string, profileType: string, log2: boolean): string {
  const pid = pidOf("sd.patient_unique_id", study);
  const raw = finiteSql("ga.alteration_value");
  const val = log2 ? "log2(" + raw + " + 1)" : raw;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "vals AS (\n" +
    "  SELECT " + pid + " AS pid, ga.hugo_gene_symbol AS gene, avg(" + val + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "    AND " + raw + " IS NOT NULL AND isFinite(" + raw + ")" + (log2 ? " AND " + raw + " >= 0" : "") + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid, gene\n" +
    ")\n" +
    "SELECT gene, count() AS n, sum(v) AS sx, sum(v * v) AS sxx FROM vals GROUP BY gene"
  );
}

/** Named MSigDB gene sets and their members' symbols (`prefix` a set-name prefix, e.g. HALLMARK_). */
export function genesetMembersSql(names: string[], prefix: string | null, db: string): string {
  const cond = names.length
    ? "gs.external_id IN (" + names.map(sq).join(",") + ")"
    : "startsWith(gs.external_id, " + sq(prefix || "HALLMARK_") + ")";
  return "SELECT gs.external_id AS set_name, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "FROM " + db + ".geneset gs\n" +
    "JOIN " + db + ".geneset_gene gg ON gg.geneset_id = gs.id\n" +
    "JOIN " + db + ".gene g ON g.entrez_gene_id = gg.entrez_gene_id\n" +
    "WHERE " + cond + " GROUP BY set_name ORDER BY set_name";
}

// ---------------------------------------------------------------------------
// paired: one patient's two kinds of sample, gene by gene

export interface PairBy { attribute: string; a: string[]; b: string[] }

/**
 * The cohort's samples split into side 'a' and side 'b' by a SAMPLE-level attribute (folded on
 * case and whitespace in both the data and the values, the one fold every clinical predicate
 * uses), restricted to patients with at least one sample on each side.
 */
function pairedSidesCtes(cohortSql: string, study: string, db: string, by: PairBy): string {
  const fold = (x: string) => clinicalValueFoldSql(x);
  const lit = (vs: string[]) => vs.map((v) => fold(sq(v))).join(",");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "sides AS (\n" +
    "  SELECT sample_unique_id AS suid, " + pidOf("patient_unique_id", study) + " AS pid,\n" +
    "         multiIf(" + fold("attribute_value") + " IN (" + lit(by.a) + "), 'a', " + fold("attribute_value") + " IN (" + lit(by.b) + "), 'b', '') AS side\n" +
    "  FROM " + clinicalTable(db, [by.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(by.attribute) + "\n" +
    "    AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),\n" +
    "ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))"
  );
}

/**
 * Per gene, among patients with a sample on each side AND profiled for the gene on each side
 * (by that side's own panels — a gene one side never assayed says nothing about concordance):
 * altered on both sides, on side a only, on side b only. A patient with several samples on a
 * side is altered on that side if any of them is. Counts only.
 *
 * `genes` null scans: every gene with a counted alteration in a paired patient's sample, and only
 * the genes with at least one patient altered on some side come back (a gene altered nowhere
 * carries no information about concordance or direction).
 */
export function pairedCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, by: PairBy,
  pin: string | null, measure: "driver" | "any"): string {
  return pairedSidesCtes(cohortSql, study, db, by) + ",\n" + sideCountsTail(study, db, genes, pin, measure);
}

/**
 * The per-gene counting after a `ps` CTE (suid, pid, side 'a' | 'b') — shared by every view that
 * puts each patient's samples on two sides: the paired view's sample attribute, the acquired
 * view's samples before and after a treatment start.
 */
function sideCountsTail(study: string, db: string, genes: string[] | null, pin: string | null, measure: "driver" | "any", exclude?: string): string {
  const scan = genes == null;
  const geneList = scan ? "SELECT DISTINCT gene FROM alt" : genes.map(sq).join(",");
  const hit = measure === "driver" ? "max(ann.is_driver)" : "1";
  return (
    "alt AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, " + (pin || measure === "any" ? hit : "0") + " AS hit\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin && measure === "driver" ? driverJoin(pin) : "") +
    "  INNER JOIN ps ON ps.suid = g.sample_unique_id\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + (scan ? "" : " AND g.hugo_gene_symbol IN (" + geneList + ")") + " AND " + ALTERED_COND + "\n" +
    // narrows the events before the annotation join rather than after it
    "    AND g.sample_unique_id IN (SELECT suid FROM ps)" + (exclude ? " AND " + exclude : "") + "\n" +
    "  GROUP BY gene, pid, side\n" +
    (scan ? "  HAVING hit > 0\n" : "") +
    "),\n" +
    "cov AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  INNER JOIN ps ON ps.suid = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,\n" +
    "         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab\n" +
    "  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)\n" +
    "  GROUP BY gene, pid\n" +
    ")\n" +
    "SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only\n" +
    "FROM per WHERE pa AND pb GROUP BY gene" + (scan ? " HAVING both + a_only + b_only > 0" : "")
  );
}

/** How many of the cohort's patients have a sample on each side, and how many samples each side holds. */
export function pairedPatientsSql(cohortSql: string, study: string, db: string, by: PairBy): string {
  return (
    pairedSidesCtes(cohortSql, study, db, by) + "\n" +
    "SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps"
  );
}

/** Every value the attribute takes among the cohort's samples, for a refusal that names them. */
export function sampleAttributeValuesSql(cohortSql: string, study: string, db: string, attribute: string): string {
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT attribute_value AS value, count() AS samples FROM " + clinicalTable(db, [attribute]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
    "  AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY value ORDER BY samples DESC LIMIT 50"
  );
}

// ---------------------------------------------------------------------------
// acquired: each patient's last sample before a treatment start and first sample after it

export interface AcquiredSides {
  /** the treatment start: its FIRST event of this type (with key = value, when given) */
  anchor: { eventType: string; key?: string; value?: string };
  /** the timeline event types that date a sample, and the attribute naming the sample */
  sampleEvents: string[]; sampleKey: string;
  /** pre: the last dated sample on or before the anchor day, at most this many days before it (null: any) */
  preWindowDays: number | null;
  /** post: the first dated sample at least this many days after the anchor */
  minGapDays: number;
}

/**
 * The cohort's patients with a dated sample on each side of a treatment start, as a `ps` CTE (one
 * sample per side: 'a' the last on or before the anchor, 'b' the first at least minGapDays after;
 * ties on a day broken by sample id, so the pick is deterministic). A sample's day is the first
 * timeline event of the given types naming it, matched to the study's samples by stable id.
 */
function acquiredSidesCtes(cohortSql: string, study: string, db: string, o: AcquiredSides): string {
  const a = o.anchor;
  const preCond = "rel <= 0" + (o.preWindowDays != null ? " AND rel >= " + (-Math.floor(o.preWindowDays)) : "");
  const postCond = "rel >= " + Math.floor(o.minGapDays);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, min(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", a.eventType) + "\n" +
    (a.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", a.key) + " AND " + foldedEqualsSql("value", String(a.value ?? "")) + ")\n" : "") +
    "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "tl AS (\n" +
    "  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("d.key", o.sampleKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedInSql("ce.event_type", o.sampleEvents) + "\n" +
    "    AND p.stable_id IN (SELECT pid FROM anch)\n" +
    "  GROUP BY pid, sample\n" +
    "),\n" +
    "dated AS (\n" +
    "  SELECT tl.pid AS pid, sd.sample_unique_id AS suid, tl.day - anch.day AS rel\n" +
    "  FROM tl INNER JOIN anch ON anch.pid = tl.pid\n" +
    "  INNER JOIN " + db + ".sample_derived sd ON sd.cancer_study_identifier = " + sq(study) + " AND sd.sample_stable_id = tl.sample AND sd.patient_stable_id = tl.pid\n" +
    "),\n" +
    "pick AS (\n" +
    "  SELECT pid, countIf(" + preCond + ") AS n_pre, countIf(" + postCond + ") AS n_post,\n" +
    "         argMaxIf(suid, (rel, suid), " + preCond + ") AS pre, argMinIf(suid, (rel, suid), " + postCond + ") AS post,\n" +
    "         maxIf(rel, " + preCond + ") AS pre_rel, minIf(rel, " + postCond + ") AS post_rel\n" +
    "  FROM dated GROUP BY pid\n" +
    "),\n" +
    "ps AS (\n" +
    "  SELECT pre AS suid, pid, 'a' AS side FROM pick WHERE n_pre > 0 AND n_post > 0\n" +
    "  UNION ALL SELECT post AS suid, pid, 'b' AS side FROM pick WHERE n_pre > 0 AND n_post > 0\n" +
    ")"
  );
}

/** Per gene, among patients with a sample before and after the anchor, both profiled for it: as pairedCountsSql (a = before, b = after). */
export function acquiredCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, o: AcquiredSides,
  pin: string | null, measure: "driver" | "any"): string {
  return acquiredSidesCtes(cohortSql, study, db, o) + ",\n" + sideCountsTail(study, db, genes, pin, measure);
}

/** The funnel from cohort to pairs: anchored, with a dated sample, with one before, one after, both; and the pairs' spacing in days. */
export function acquiredFunnelSql(cohortSql: string, study: string, db: string, o: AcquiredSides): string {
  const both = "n_pre > 0 AND n_post > 0";
  return (
    acquiredSidesCtes(cohortSql, study, db, o) + "\n" +
    "SELECT (SELECT count() FROM anch) AS anchored, (SELECT uniqExact(pid) FROM tl) AS with_events, count() AS dated,\n" +
    "       countIf(n_pre > 0) AS with_pre, countIf(n_post > 0) AS with_post, countIf(" + both + ") AS paired,\n" +
    "       quantileExactIf(0.5)(-pre_rel, " + both + ") AS pre_median, quantileExactIf(0.5)(post_rel, " + both + ") AS post_median,\n" +
    "       quantileExactIf(0.25)(post_rel - pre_rel, " + both + ") AS gap_q1, quantileExactIf(0.5)(post_rel - pre_rel, " + both + ") AS gap_median,\n" +
    "       quantileExactIf(0.75)(post_rel - pre_rel, " + both + ") AS gap_q3\n" +
    "FROM pick"
  );
}

// ---------------------------------------------------------------------------
// ctdna: a patient's plasma (cfDNA) samples against their tissue samples

export interface CtdnaSides {
  /** the sample attribute that classes samples (SAMPLE_CLASS), its plasma values and its tissue values */
  attribute: string; plasma: string[]; tissue: string[];
  /** samples on these panels are plasma whatever the attribute says (e.g. ACCESS129) */
  plasmaPanels: string[];
  /** keep only samples with a sample of the other kind dated within this many days (timeline dates); null: no dates needed */
  withinDays: number | null;
  sampleEvents: string[]; sampleKey: string;
  /**
   * leave out plasma mutation calls likely from clonal haematopoiesis: those in `genes`, and (with
   * `normalMinAlt`) those whose matched normal (white-cell) sample carries at least that many
   * alternate reads at an allele fraction at least `normalMinRatio` of the plasma's; absent, every call counts
   */
  ch?: { genes: string[]; normalMinAlt: number | null; normalMinRatio: number };
}

/**
 * The cohort's samples classed plasma ('b') or tissue ('a'), as a `ps` CTE of the patients with
 * both; `sides` keeps every classed sample, for questions about plasma alone. With `withinDays`,
 * a sample is kept only when the timeline dates it and a sample of the other kind within that
 * many days (`dated` and `near` say how many).
 */
function ctdnaSidesCtes(cohortSql: string, study: string, db: string, o: CtdnaSides): string {
  const fold = (x: string) => clinicalValueFoldSql(x);
  const lit = (vs: string[]) => vs.map((v) => fold(sq(v))).join(",");
  const dated = o.withinDays != null;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "cls AS (\n" +
    "  SELECT sample_unique_id AS suid, any(" + fold("attribute_value") + ") AS v\n" +
    "  FROM " + clinicalTable(db, [o.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(o.attribute) + "\n" +
    "    AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY suid\n" +
    "),\n" +
    "classed AS (\n" +
    "  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,\n" +
    "         multiIf(" + (o.plasmaPanels.length ? "sd.sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_to_gene_panel_derived WHERE cancer_study_identifier = " + sq(study) +
      " AND gene_panel_id IN (" + o.plasmaPanels.map(sq).join(",") + ")), 'b', " : "") +
    "cls.v IN (" + lit(o.plasma) + "), 'b', cls.v IN (" + lit(o.tissue) + "), 'a', '') AS side\n" +
    "  FROM " + db + ".sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id\n" +
    "  WHERE sd.cancer_study_identifier = " + sq(study) + " AND sd.patient_stable_id IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (dated
      ? "tl AS (\n" +
        "  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day\n" +
        "  FROM " + db + ".clinical_event ce\n" +
        "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
        "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
        "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("d.key", o.sampleKey) + "\n" +
        "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedInSql("ce.event_type", o.sampleEvents) + "\n" +
        "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid, sample\n" +
        "),\n" +
        "dated AS (SELECT c.suid AS suid, c.pid AS pid, c.side AS side, tl.day AS day FROM classed c INNER JOIN tl ON tl.pid = c.pid AND tl.sample = c.sample WHERE c.side != ''),\n" +
        "near AS (\n" +
        "  SELECT DISTINCT x.suid AS suid FROM dated x INNER JOIN dated y ON y.pid = x.pid\n" +
        "  WHERE x.side != y.side AND abs(x.day - y.day) <= " + Math.floor(o.withinDays!) + "\n" +
        "),\n" +
        "sides AS (SELECT suid, pid, side FROM classed WHERE side != '' AND suid IN (SELECT suid FROM near)),\n"
      : "sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),\n") +
    "paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),\n" +
    "ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired))" +
    (o.ch ? ",\n" + ctdnaChCte(study, db, o.ch) : "")
  );
}

/**
 * `chx`: the plasma samples' mutation calls a clonal-haematopoiesis rule removes — by gene, or by
 * alternate reads in the matched normal (mutation_derived's normal counts, where the study loads them).
 */
function ctdnaChCte(study: string, db: string, ch: NonNullable<CtdnaSides["ch"]>): string {
  const byGene = ch.genes.length ? "g.hugo_gene_symbol IN (" + ch.genes.map(sq).join(",") + ")" : "0";
  const normal = ch.normalMinAlt != null;
  return (
    (normal
      ? "nm AS (\n" +
        "  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,\n" +
        "         max(normalAltCount >= " + Math.floor(ch.normalMinAlt!) + " AND normalAltCount / (normalAltCount + normalRefCount) >= " + Number(ch.normalMinRatio) +
        " * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded\n" +
        "  FROM " + db + ".mutation_derived\n" +
        "  WHERE studyId = " + sq(study) + " AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')\n" +
        "  GROUP BY suid, gene, mv\n" +
        "),\n"
      : "") +
    "chx AS (\n" +
    "  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,\n" +
    "         max(" + byGene + ") AS by_gene, " + (normal ? "max(ifNull(nm.hit, 0) = 1)" : "toUInt8(0)") + " AS by_normal,\n" +
    "         " + (normal ? "max(ifNull(nm.loaded, 0) = 1)" : "toUInt8(0)") + " AS has_normal\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (normal ? "  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant\n" : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation'\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')\n" +
    "  GROUP BY suid, gene, mv\n" +
    ")"
  );
}

/** with a CH rule, the condition that keeps an event: not a plasma mutation call `chx` removes (`side` is the side column) */
const chKeep = (o: CtdnaSides, side: string): string | undefined => o.ch
  ? "NOT (" + side + " = 'b' AND g.variant_type = 'mutation' AND (g.sample_unique_id, g.hugo_gene_symbol, g.mutation_variant) IN (SELECT suid, gene, mv FROM chx WHERE by_gene OR by_normal))"
  : undefined;

/** Per gene, among patients with plasma and tissue both profiled for it: as pairedCountsSql (a = tissue, b = plasma). */
export function ctdnaCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, o: CtdnaSides,
  pin: string | null, measure: "driver" | "any"): string {
  return ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" + sideCountsTail(study, db, genes, pin, measure, chKeep(o, "ps.side"));
}

/**
 * The patients with a plasma sample, a tissue sample, both (and, with dates, how many classed
 * samples were dated); and of those with plasma, how many had any alteration called in it
 * (ctDNA detected: a mutation, an amplification or deep deletion, or a structural variant; with
 * `driver`, an OncoKB oncogenic one).
 */
export function ctdnaFunnelSql(cohortSql: string, study: string, db: string, o: CtdnaSides, pin: string | null, measure: "driver" | "any"): string {
  return (
    ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" +
    ctdnaDetectedCte(study, db, pin, measure, chKeep(o, "s.side")) + "\n" +
    "SELECT (SELECT uniqExactIf(pid, side = 'b') FROM classed) AS plasma_all, (SELECT uniqExactIf(pid, side = 'a') FROM classed) AS tissue_all,\n" +
    "       (SELECT uniqExactIf(pid, side = 'b') FROM sides) AS plasma, (SELECT uniqExactIf(pid, side = 'a') FROM sides) AS tissue,\n" +
    "       (SELECT count() FROM paired) AS both, (SELECT count() FROM det) AS detected,\n" +
    "       (SELECT countIf(side = 'b') FROM ps) AS plasma_samples, (SELECT countIf(side = 'a') FROM ps) AS tissue_samples,\n" +
    "       " + (o.withinDays != null ? "(SELECT count() FROM dated)" : "toUInt64(0)") + " AS dated_samples" +
    (o.ch ? ",\n       (SELECT count() FROM chx) AS ch_calls, (SELECT countIf(has_normal) FROM chx) AS ch_with_normal,\n" +
      "       (SELECT countIf(by_gene) FROM chx) AS ch_by_gene, (SELECT countIf(by_normal) FROM chx) AS ch_by_normal, (SELECT countIf(by_gene OR by_normal) FROM chx) AS ch_removed,\n" +
      "       (SELECT uniqExact(s.pid) FROM chx INNER JOIN sides s ON s.suid = chx.suid WHERE by_gene OR by_normal) AS ch_patients" : "") + "\n" +
    "FROM system.one"
  );
}

/** the patients with any (driver) alteration called in a plasma sample */
function ctdnaDetectedCte(study: string, db: string, pin: string | null, measure: "driver" | "any", exclude?: string): string {
  return (
    "det AS (\n" +
    "  SELECT DISTINCT s.pid AS pid FROM " + db + ".genomic_event_derived g\n" +
    (pin && measure === "driver" ? driverJoin(pin) : "") +
    "  INNER JOIN sides s ON s.suid = g.sample_unique_id\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND s.side = 'b' AND " + ALTERED_COND + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')" + (pin && measure === "driver" ? " AND ann.is_driver" : measure === "driver" ? " AND 0" : "") +
    (exclude ? " AND " + exclude : "") + "\n" +
    ")"
  );
}

/**
 * Overall survival of the patients with a plasma sample, by ctDNA detected or not: counts of
 * (detected, months, dead) — OS_MONTHS / OS_STATUS as the study records them.
 */
export function ctdnaSurvivalSql(cohortSql: string, study: string, db: string, o: CtdnaSides, pin: string | null, measure: "driver" | "any"): string {
  const pid = pidOf("patient_unique_id", study);
  return (
    ctdnaSidesCtes(cohortSql, study, db, o) + ",\n" +
    ctdnaDetectedCte(study, db, pin, measure, chKeep(o, "s.side")) + ",\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid, toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead, " + pid + " IN (SELECT pid FROM det) AS detected\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM sides WHERE side = 'b')\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT detected, round(months, 2) AS t, dead, count() AS n\n" +
    "FROM os WHERE months IS NOT NULL AND months >= 0 GROUP BY detected, t, dead ORDER BY t"
  );
}

/** with a CH rule: per gene, the plasma mutation calls it removes and their patients, by which rule */
export function ctdnaChRemovedSql(cohortSql: string, study: string, db: string, o: CtdnaSides): string {
  if (!o.ch) throw new Error("ctdnaChRemovedSql needs a CH rule");
  return (
    ctdnaSidesCtes(cohortSql, study, db, o) + "\n" +
    "SELECT chx.gene AS gene, countIf(by_gene OR by_normal) AS calls, uniqExactIf(s.pid, by_gene OR by_normal) AS patients,\n" +
    "       countIf(by_gene) AS gene_calls, countIf(by_normal) AS normal_calls\n" +
    "FROM chx INNER JOIN sides s ON s.suid = chx.suid\n" +
    "GROUP BY gene HAVING calls > 0 ORDER BY calls DESC, gene LIMIT 40"
  );
}

// ---------------------------------------------------------------------------
// exclusivity: the sample-by-gene alteration matrix, reduced to what DISCOVER's background needs

/**
 * The cohort's samples with a gene panel, each with its panel signature (every panel it was
 * profiled on, any alteration type, joined), its stratum (a sample attribute's folded value, or
 * '' unstratified), and its altered genes among those its panels cover (any alteration, or OncoKB
 * drivers): `sp`, `altc` and `strat` CTEs.
 */
function exclusivityCtes(cohortSql: string, study: string, db: string, stratifyBy: string | null, pin: string | null, measure: "driver" | "any"): string {
  const driver = measure === "driver";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "sp AS (\n" +
    "  SELECT sample_unique_id AS suid, arrayStringConcat(arraySort(groupUniqArray(gene_panel_id)), '+') AS sig\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "    AND sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + sq(study) +
    " AND patient_stable_id IN (SELECT pid FROM cohort))\n" +
    "  GROUP BY suid\n" +
    "),\n" +
    "cov AS (\n" +
    "  SELECT DISTINCT s.sig AS sig, pg.gene AS gene\n" +
    "  FROM (SELECT DISTINCT sig, arrayJoin(splitByChar('+', sig)) AS panel FROM sp) s\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = s.panel\n" +
    "),\n" +
    "altc AS (\n" +
    "  SELECT DISTINCT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driver && pin ? driverJoin(pin) : "") +
    "  INNER JOIN sp ON sp.suid = g.sample_unique_id\n" +
    "  INNER JOIN cov ON cov.sig = sp.sig AND cov.gene = g.hugo_gene_symbol\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND " + ALTERED_COND + (driver ? (pin ? " AND ann.is_driver" : " AND 0") : "") + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM sp)\n" +
    "),\n" +
    "strat AS (\n" +
    (stratifyBy
      ? "  SELECT sample_unique_id AS suid, any(" + clinicalValueFoldSql("attribute_value") + ") AS v FROM " + clinicalTable(db, [stratifyBy]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(stratifyBy) + " AND sample_unique_id IN (SELECT suid FROM sp)\n" +
        "  GROUP BY suid\n"
      : "  SELECT suid, '' AS v FROM sp\n") +
    ")"
  );
}

/**
 * The samples grouped by what their background probability depends on — panel signature,
 * stratum and burden r (altered covered genes) — and by which of `genes` they have altered (a
 * bitmask, bit i for genes[i]): counts only.
 */
export function exclusivityGroupsSql(cohortSql: string, study: string, db: string, genes: string[], stratifyBy: string | null,
  pin: string | null, measure: "driver" | "any"): string {
  const mask = genes.map((g, i) => "maxIf(" + (2 ** i) + ", altc.gene = " + sq(g) + ")").join(" + ") || "0";
  return (
    exclusivityCtes(cohortSql, study, db, stratifyBy, pin, measure) + ",\n" +
    "per AS (SELECT suid, count() AS r, " + mask + " AS amask FROM altc GROUP BY suid)\n" +
    "SELECT sp.sig AS sig, ifNull(strat.v, '') AS stratum, per.r AS r, per.amask AS amask, count() AS n\n" +
    "FROM sp LEFT JOIN per ON per.suid = sp.suid LEFT JOIN strat ON strat.suid = sp.suid\n" +
    "GROUP BY sig, stratum, r, amask"
  );
}

/** Per stratum and gene, the samples with that gene altered (the background's column sums). */
export function exclusivityColumnsSql(cohortSql: string, study: string, db: string, stratifyBy: string | null, pin: string | null, measure: "driver" | "any"): string {
  return (
    exclusivityCtes(cohortSql, study, db, stratifyBy, pin, measure) + "\n" +
    "SELECT ifNull(strat.v, '') AS stratum, altc.gene AS gene, count() AS n\n" +
    "FROM altc LEFT JOIN strat ON strat.suid = altc.suid GROUP BY stratum, gene"
  );
}

/** The genes each panel signature in the cohort covers. Metadata only. */
export function exclusivityCoverageSql(cohortSql: string, study: string, db: string): string {
  return exclusivityCtes(cohortSql, study, db, null, null, "any") + "\nSELECT sig, gene FROM cov";
}

// ---------------------------------------------------------------------------
// instability: genome-wide instability scores per sample, from the same segments

/**
 * hg19 centromeres: the boundary between band p11.1 (p11.11 on chr11) and q11 in UCSC's hg19
 * cytoBand table (hgdownload.soe.ucsc.edu/goldenPath/hg19/database/cytoBand.txt.gz). The p arm
 * is [0, centromere), the q arm [centromere, chromosome length) (CHROM_LENGTHS.hg19).
 */
export const HG19_CENTROMERES: Record<string, number> = {
  "1": 125000000, "2": 93300000, "3": 91000000, "4": 50400000, "5": 48400000, "6": 61000000, "7": 59900000,
  "8": 45600000, "9": 49000000, "10": 40200000, "11": 53700000, "12": 35800000, "13": 17900000, "14": 17600000,
  "15": 19000000, "16": 36600000, "17": 24000000, "18": 17200000, "19": 26500000, "20": 27500000, "21": 13200000,
  "22": 14700000, "X": 60600000
};
/** the acrocentric p arms, which carry no unique sequence to measure — left out, as Taylor et al. 2018 did */
const ACROCENTRIC = ["13", "14", "15", "21", "22"];
/** the arms scored: 39 autosomal arms (and Xp, Xq with includeX), in genome order */
export function instabilityArms(includeX: boolean): string[] {
  return GENOME_CHROMS.filter((c) => includeX || c !== "X").flatMap((c) => ACROCENTRIC.includes(c) ? [c + "q"] : [c + "p", c + "q"]);
}

export interface InstabilityOpts { threshold: number; armShare: number; includeX: boolean }

/**
 * Per segmented sample (in SQL, never returned): its FGA — the share of its segmented length on
 * the scored chromosomes whose |segment mean| is past the threshold — and, per arm, the share of
 * the arm's length gained and lost; an arm is gained (lost) when that share passes armShare, and
 * measured when segments cover at least armShare of it. Aneuploidy score = arms gained or lost.
 */
function instabilityCtes(cohortSql: string, study: string, db: string, o: InstabilityOpts): string {
  const T = Number(o.threshold), S = Number(o.armShare);
  const chroms = GENOME_CHROMS.filter((c) => o.includeX || c !== "X");
  const arr = (xs: (string | number)[]) => "[" + xs.map((x) => typeof x === "number" ? String(x) : sq(x)).join(",") + "]";
  const cen = "transform(chrom, " + arr([...chroms]) + ", " + arr(chroms.map((c) => HG19_CENTROMERES[c])) + ", 0)";
  const len = "transform(chrom, " + arr([...chroms]) + ", " + arr(chroms.map((c) => CHROM_LENGTHS.hg19[c])) + ", 0)";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "seg AS (\n" +
    "  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,\n" +
    "         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m\n" +
    "  FROM " + db + ".copy_number_seg s\n" +
    "  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)\n" +
    "),\n" +
    "parts AS (\n" +
    "  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (\n" +
    "    SELECT sid, chrom, m, st, en, " + cen + " AS c, " + len + " AS l,\n" +
    "           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,\n" +
    "           a.1 AS arm, a.2 AS lo, a.3 AS hi\n" +
    "    FROM seg WHERE chrom IN (" + chroms.map(sq).join(",") + ") AND en > st\n" +
    "  ) WHERE NOT (arm IN (" + ACROCENTRIC.map((c) => sq(c + "p")).join(",") + "))\n" +
    "),\n" +
    "arms AS (\n" +
    "  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= " + T + ") AS gbp, sumIf(bp, m <= " + (-T) + ") AS lbp\n" +
    "  FROM parts GROUP BY sid, arm\n" +
    "),\n" +
    "calls AS (\n" +
    "  SELECT sid, arm, cov >= " + S + " * alen AS measured, gbp > " + S + " * alen AS gain, lbp > " + S + " * alen AS loss FROM arms\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,\n" +
    "         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured\n" +
    "  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid\n" +
    ")"
  );
}

/** FGA in 1-point bins × aneuploidy score, with how many arms each sample had measured: counts of samples. */
export function instabilityScoresSql(cohortSql: string, study: string, db: string, o: InstabilityOpts): string {
  return (
    instabilityCtes(cohortSql, study, db, o) + "\n" +
    "SELECT toInt32(least(100, floor(100 * alt / greatest(1, cov)))) AS fga_bin, score, measured, count() AS n\n" +
    "FROM per GROUP BY fga_bin, score, measured ORDER BY fga_bin, score"
  );
}

/** Per arm: the samples that measured it, and those with it gained or lost. */
export function instabilityArmsSql(cohortSql: string, study: string, db: string, o: InstabilityOpts): string {
  return (
    instabilityCtes(cohortSql, study, db, o) + "\n" +
    "SELECT arm, countIf(measured) AS n_measured, countIf(measured AND gain) AS n_gain, countIf(measured AND loss) AS n_loss FROM calls GROUP BY arm"
  );
}

// ---------------------------------------------------------------------------
// clonality: FACETS allele-specific copy number, per mutation call

/** The cohort's samples; with `qc`, only those whose FACETS_QC is Pass. */
function facetsSamplesCte(cohortSql: string, study: string, db: string, qc: boolean): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid, sample_unique_id AS suid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    (qc
      ? "    AND sample_unique_id IN (SELECT sample_unique_id FROM " + clinicalTable(db, ["FACETS_QC"]) + "\n" +
        "      WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = 'FACETS_QC'\n" +
        "        AND " + clinicalValueFoldSql("attribute_value") + " = 'pass')\n"
      : "") +
    ")"
  );
}

/**
 * Per gene, over the cohort's mutation CALLS that carry a FACETS estimate (a call is one mutation
 * in one sample): how many are clonal, subclonal, indeterminate or uncalled; how many sit in a
 * region with no minor allele (LOH at the locus), of those where the minor copy number is
 * known; and the cancer-cell fraction in ten bins. Only the study's current mutation profile is
 * read — the table also holds orphaned rows from superseded loads.
 */
export function clonalityGenesSql(cohortSql: string, study: string, db: string, genes: string[], pin: string | null,
  measure: "driver" | "any", qc: boolean): string {
  const geneList = genes.map(sq).join(",");
  const drv = measure === "driver" && pin;
  return (
    facetsSamplesCte(cohortSql, study, db, qc) + ",\n" +
    "prof AS (\n" +
    "  SELECT gp.genetic_profile_id AS id FROM " + db + ".genetic_profile gp\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'\n" +
    "),\n" +
    "calls AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, a.sample_id AS sid, a.clonal AS call_state, a.ccf_expected_copies AS ccf, a.minor_copy_number AS minor\n" +
    "  FROM " + db + ".allele_specific_copy_number a\n" +
    "  JOIN " + db + ".mutation_event me ON me.mutation_event_id = a.mutation_event_id\n" +
    "  JOIN " + db + ".gene g ON g.entrez_gene_id = me.entrez_gene_id\n" +
    (drv
      ? "  INNER JOIN oncokb_annotation.variant_annotation ann ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
        "    AND ann.hugo_gene_symbol = g.hugo_gene_symbol AND ann.alteration_type = 'MUTATION' AND ann.alteration = me.protein_change\n"
      : "") +
    "  WHERE a.genetic_profile_id IN (SELECT id FROM prof) AND a.sample_id IN (SELECT sid FROM samp)\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ")\n" +
    ")\n" +
    "SELECT gene, count() AS calls, uniqExact(sid) AS samples,\n" +
    "       countIf(call_state = 'CLONAL') AS clonal, countIf(call_state = 'SUBCLONAL') AS subclonal,\n" +
    "       countIf(call_state = 'INDETERMINATE') AS indeterminate,\n" +
    "       countIf(minor = 0) AS loh, countIf(minor IS NOT NULL) AS loh_known,\n" +
    Array.from({ length: 10 }, (_, i) =>
      "       countIf(ccf >= " + (i / 10) + (i === 9 ? "" : " AND ccf < " + ((i + 1) / 10)) + ") AS ccf" + i).join(",\n") + "\n" +
    "FROM calls GROUP BY gene"
  );
}

/**
 * Per cohort: its samples, how many carry any FACETS estimate, FACETS_QC pass/fail over ALL of
 * them, and whole-genome doubling among the samples considered (QC-passing ones, with `qc`).
 */
export function facetsSummarySql(cohortSql: string, study: string, db: string, qc: boolean): string {
  const attr = (name: string) => "(SELECT sample_unique_id AS suid, " + clinicalValueFoldSql("attribute_value") + " AS v FROM " + clinicalTable(db, [name]) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(name) + ")";
  const considered = qc ? " AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')" : "";
  return (
    facetsSamplesCte(cohortSql, study, db, false) + ",\n" +
    "prof AS (\n" +
    "  SELECT gp.genetic_profile_id AS id FROM " + db + ".genetic_profile gp\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'\n" +
    "),\n" +
    "wgd AS " + attr("FACETS_WGD") + ",\n" +
    "qcv AS " + attr("FACETS_QC") + "\n" +
    "SELECT count() AS samples,\n" +
    "       countIf(sid IN (SELECT DISTINCT sample_id FROM " + db + ".allele_specific_copy_number WHERE genetic_profile_id IN (SELECT id FROM prof))) AS ascn_samples,\n" +
    "       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS qc_pass,\n" +
    "       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'fail')) AS qc_fail,\n" +
    "       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'true')" + considered + ") AS wgd_true,\n" +
    "       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'false')" + considered + ") AS wgd_false\n" +
    "FROM samp"
  );
}

/** FACETS purity (0.05 bins over 0-1) and ploidy (0.25 bins over 0-8) among the samples considered. */
export function facetsHistogramSql(cohortSql: string, study: string, db: string, qc: boolean): string {
  return (
    facetsSamplesCte(cohortSql, study, db, qc) + "\n" +
    "SELECT attribute_name AS attr,\n" +
    "       toInt32(floor(least(if(attribute_name = 'FACETS_PURITY', 0.9999, 7.9999), greatest(0, " + finiteSql("attribute_value") + ")) /\n" +
    "         if(attribute_name = 'FACETS_PURITY', 0.05, 0.25))) AS bin,\n" +
    "       count() AS n\n" +
    "FROM " + clinicalTable(db, ["FACETS_PURITY", "FACETS_PLOIDY"]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name IN ('FACETS_PURITY', 'FACETS_PLOIDY')\n" +
    "  AND sample_unique_id IN (SELECT suid FROM samp) AND " + finiteSql("attribute_value") + " IS NOT NULL\n" +
    "GROUP BY attr, bin ORDER BY attr, bin"
  );
}

/** Which studies hold allele-specific copy number for their current mutation profile. Metadata only. */
export function ascnStudiesSql(_study: string, db: string): string {
  return "SELECT DISTINCT cs.cancer_study_identifier AS study FROM " + db + ".allele_specific_copy_number a\n" +
    "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = a.genetic_profile_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id ORDER BY study";
}

// ---------------------------------------------------------------------------
// incidence: time to a timeline event, with death as the competing risk

export interface EventSel { eventType: string; attrs?: { key: string; value: string }[] }
export interface IncidenceAnchor { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" }

/** Timeline events of a type (with every given attribute), per cohort patient: (pid, day). */
function eventDaysSql(db: string, study: string, sel: EventSel, cohortRef: string): string {
  const attrs = (sel.attrs || []).slice(0, 3);
  return "SELECT p.stable_id AS pid, ce.start_date AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", sel.eventType) + "\n" +
    attrs.map((a) => "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", a.key) + " AND " + foldedEqualsSql("value", a.value) + ")\n").join("") +
    "    AND p.stable_id IN (SELECT pid FROM " + cohortRef + ")";
}

/**
 * Per cohort, counts of (entry, t, cause) in months from the anchor (the study's day 0 when
 * there is none): cause 1 the first qualifying event after the anchor, 2 death without it
 * (OS_STATUS), 0 censored at last follow-up (OS_MONTHS). Entry is the delay from the anchor to
 * day 0 when the anchor precedes it — the same left truncation the survival view applies, since
 * a patient is only in the study because they were alive at day 0.
 *
 * Patients who cannot enter the risk set are counted under `kind`, never silently dropped:
 * 'prior' already had the event at or before the anchor; 'unobserved' had it after the anchor
 * but before observation began; 'nofollowup' has no OS follow-up (or none after the anchor);
 * 'late' is a flag on records whose first event was recorded after their last follow-up (they
 * are kept, as censored or dead at follow-up). A cohort patient with no anchor event appears in
 * no row at all; the caller counts them as the cohort size less every row's n.
 */
export function incidenceCountsSql(cohortSql: string, study: string, db: string, event: EventSel, anchor: IncidenceAnchor | null): string {
  const pid = pidOf("patient_unique_id", study);
  const pick = anchor?.occurrence === "LAST" ? "max" : "min";
  const anchCte = anchor
    ? "anch AS (\n" +
      "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" +
      (anchor.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
        foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n" : "") +
      "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      "),\n"
    : "anch AS (SELECT pid, toInt64(0) AS day FROM cohort),\n";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + finiteSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    anchCte +
    "ev AS (" + eventDaysSql(db, study, event, "cohort") + "),\n" +
    "evs AS (\n" +
    "  SELECT ev.pid AS pid, countIf(ev.day <= anch.day) AS n_prior, countIf(ev.day > anch.day) AS n_after,\n" +
    "         minIf(ev.day, ev.day > anch.day) AS first_after\n" +
    "  FROM ev INNER JOIN anch ON anch.pid = ev.pid GROUP BY ev.pid\n" +
    "),\n" +
    "per AS (\n" +
    "  SELECT anch.pid AS pid, anch.day AS a, os.months AS months, os.status LIKE '1%' AS dead,\n" +
    "         evs.pid != '' AS has_ev, evs.n_prior AS n_prior, evs.n_after AS n_after, evs.first_after AS first_after\n" +
    "  FROM anch\n" +
    "  LEFT JOIN os ON os.pid = anch.pid\n" +
    "  LEFT JOIN evs ON evs.pid = anch.pid\n" +
    "),\n" +
    "cls AS (\n" +
    "  SELECT greatest(0, -a) / 30.4375 AS entry, months - a / 30.4375 AS tend,\n" +
    "         (first_after - a) / 30.4375 AS tev,\n" +
    "         multiIf(months IS NULL OR months - a / 30.4375 <= 0, 'nofollowup',\n" +
    "                 has_ev AND n_prior > 0, 'prior',\n" +
    "                 has_ev AND n_after > 0 AND first_after < 0, 'unobserved',\n" +
    "                 'record') AS kind,\n" +
    "         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 <= months - a / 30.4375 AS hit,\n" +
    "         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 > months - a / 30.4375 AS late,\n" +
    "         dead\n" +
    "  FROM per\n" +
    ")\n" +
    "SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(if(hit, tev, tend), 4), 0) AS t,\n" +
    "       if(kind != 'record', -1, if(hit, 1, if(dead, 2, 0))) AS cause, late, count() AS n\n" +
    "FROM cls GROUP BY kind, entry, t, cause, late ORDER BY t"
  );
}

// ---------------------------------------------------------------------------
// labs: a lab value's course from treatment start, as % change from baseline

export interface LabSpec {
  /** the event type holding lab results, and the key/value naming this test (e.g. TEST = PSA) */
  eventType: string; testKey: string; test: string;
  /** the attribute holding the numeric result */
  resultKey: string;
}
export interface LabOpts {
  /** baseline: the last value within this many days before (or on) the anchor */
  baselineDays: number;
  /** window around the anchor, and bin width, in days */
  fromDays: number; toDays: number; binDays: number;
}
/**
 * % change is binned in 2-point steps CENTRED on −100, −98, … +300 (so an unchanged value sits
 * exactly at 0, not at a bin's edge); values above +300 share the top bin.
 */
export const LAB_PCT_BIN = 2, LAB_PCT_MIN = -100, LAB_PCT_MAX = 300;
export const LAB_PCT_BINS = (LAB_PCT_MAX - LAB_PCT_MIN) / LAB_PCT_BIN + 1;

function labCtes(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts): string {
  const pick = anchor.occurrence === "LAST" ? "max" : "min";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" +
    (anchor.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n" : "") +
    "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "lab AS (\n" +
    "  SELECT p.stable_id AS pid, ce.start_date AS day, " + finiteSql("r.value") + " AS v\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", lab.testKey) + " AND " + foldedEqualsSql("t.value", lab.test) + "\n" +
    "  JOIN " + db + ".clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("r.key", lab.resultKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", lab.eventType) + "\n" +
    "    AND p.stable_id IN (SELECT pid FROM anch) AND " + finiteSql("r.value") + " IS NOT NULL\n" +
    "),\n" +
    "base AS (\n" +
    // the baseline is the mean of the readings on the last day with any, so several readings that day
    // give one answer rather than whichever row came first
    "  SELECT lab.pid AS pid, max(lab.day) AS bday,\n" +
    "         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b\n" +
    "  FROM lab INNER JOIN anch ON anch.pid = lab.pid\n" +
    "  WHERE lab.day >= anch.day - " + Math.floor(o.baselineDays) + " AND lab.day <= anch.day GROUP BY lab.pid\n" +
    "),\n" +
    "chg AS (\n" +
    "  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc\n" +
    "  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid\n" +
    "  WHERE base.b > 0 AND lab.day != base.bday\n" +
    "    AND lab.day - anch.day >= " + Math.floor(o.fromDays) + " AND lab.day - anch.day <= " + Math.floor(o.toDays) + "\n" +
    ")"
  );
}

const pctBin = (x: string) =>
  "toInt32(floor((least(" + LAB_PCT_MAX + ", greatest(" + LAB_PCT_MIN + ", " + x + ")) - (" + LAB_PCT_MIN + ") + " + (LAB_PCT_BIN / 2) + ") / " + LAB_PCT_BIN + "))";

/**
 * The course: per time bin, the histogram of % change from baseline (each patient's mean within
 * the bin, so a patient tested weekly weighs no more than one tested monthly). The baseline
 * reading itself — 0% by definition — is not part of the course. Counts only.
 */
export function labCourseSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts): string {
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT tbin, pbin, count() AS n FROM (\n" +
    "  SELECT pid, toInt32(floor(rel / " + Math.max(1, Math.floor(o.binDays)) + ")) AS tbin, " + pctBin("avg(pc)") + " AS pbin\n" +
    "  FROM chg GROUP BY pid, tbin\n" +
    ") GROUP BY tbin, pbin ORDER BY tbin, pbin"
  );
}

/**
 * Best response: each patient's lowest % change after the anchor (within the window), binned;
 * how many fell by at least `responseDrop` percent, counted exactly rather than from the bins;
 * and the counts behind the denominators — patients anchored, with a baseline, with a positive
 * baseline, and with any value after the anchor.
 */
export function labBestSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, responseDrop: number): string {
  const best = "(SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)";
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT 'best' AS what, " + pctBin("best") + " AS pbin, count() AS n FROM " + best + " GROUP BY pbin\n" +
    "UNION ALL SELECT 'responders' AS what, 0 AS pbin, countIf(best <= " + (-Math.abs(Number(responseDrop))) + ") AS n FROM " + best + "\n" +
    "UNION ALL SELECT 'anchored' AS what, 0 AS pbin, count() AS n FROM anch\n" +
    "UNION ALL SELECT 'baseline' AS what, 0 AS pbin, count() AS n FROM base\n" +
    "UNION ALL SELECT 'positive_baseline' AS what, 0 AS pbin, countIf(b > 0) AS n FROM base\n" +
    "UNION ALL SELECT 'after' AS what, 0 AS pbin, uniqExactIf(pid, rel > 0) AS n FROM chg"
  );
}

/**
 * Each patient's best % change, one row per patient and no identifier — the values behind a
 * waterfall. Patient-level: only PatientLevelResolver.viewRows runs it, the same entitlement
 * that lets a plot draw its points.
 */
export function labWaterfallSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, cap: number): string {
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)\n" +
    "ORDER BY best LIMIT " + Math.max(1, Math.floor(cap))
  );
}

/** The tests a lab event type holds, with how many patients and results each has. */
export function labTestsSql(cohortSql: string, study: string, db: string, eventType: string, testKey: string): string {
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT " + nameFoldSql("t.value") + " AS tk, arraySort((x) -> (-x.2, x.1), arrayMap((v) -> (v, countEqual(groupArray(trimBoth(t.value)), v)), groupUniqArray(trimBoth(t.value))))[1].1 AS test,\n" +
    "       uniqExact(ce.patient_id) AS patients, count() AS results\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", testKey) + "\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", eventType) + " AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "GROUP BY tk ORDER BY patients DESC, tk LIMIT 40"
  );
}

// ---------------------------------------------------------------------------
// cancertypes: a gene list's alteration frequency per group of samples

/**
 * Per group of the cohort's samples (a sample attribute's value, or the study) and per gene — plus
 * the row "*" for the genes together — the units profiled for that gene and how many are altered,
 * split by kind: only mutations, only amplifications, only deep deletions, only structural variants,
 * or more than one kind. A unit is a SAMPLE, or a PATIENT counted in each group one of their
 * samples falls in (the portal's default); a patient is profiled when any of their samples is, and
 * carries the union of their samples' alterations. Counts only.
 */
export function cancerTypesSql(cohortSql: string, study: string, db: string, genes: string[], attribute: string | null,
  pin: string | null, measure: "driver" | "any", unit: "sample" | "patient" = "sample"): string {
  const geneList = genes.map(sq).join(",");
  const drv = measure === "driver" && pin;
  const fold = clinicalValueFoldSql("attribute_value");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (attribute
      ? "grp AS (\n" +
        "  SELECT sample_unique_id AS suid, any(" + fold + ") AS g, any(attribute_value) AS label FROM " + clinicalTable(db, [attribute]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
        "    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
        "),\n"
      : "grp AS (SELECT suid, " + sq(study) + " AS g, " + sq(study) + " AS label FROM samp),\n") +
    "alt AS (\n" +
    "  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene,\n" +
    "         multiIf(g.variant_type = 'mutation', 'mutation', g.variant_type = 'cna' AND g.cna_alteration >= 2, 'amp',\n" +
    "                 g.variant_type = 'cna', 'homdel', 'sv') AS t\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (drv ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND g.sample_unique_id IN (SELECT suid FROM samp)" + (drv ? " AND ann.is_driver" : "") + "\n" +
    "  GROUP BY suid, gene, t\n" +
    "),\n" +
    // a sample is profiled for a gene its panel lists, and for one it is altered in (an off-panel call is a measurement)
    "cov AS (\n" +
    "  SELECT DISTINCT sp.sample_unique_id AS suid, pg.gene AS gene FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.sample_unique_id IN (SELECT suid FROM samp)\n" +
    "    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "  UNION DISTINCT SELECT DISTINCT suid, gene FROM alt\n" +
    "),\n" +
    "sg AS (\n" +
    "  SELECT cov.suid AS suid, cov.gene AS gene, groupUniqArrayIf(alt.t, alt.t != '') AS types\n" +
    "  FROM cov LEFT JOIN alt ON alt.suid = cov.suid AND alt.gene = cov.gene GROUP BY suid, gene\n" +
    "),\n" +
    "sg2 AS (SELECT suid, gene, types FROM sg UNION ALL SELECT suid, '*' AS gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM sg GROUP BY suid),\n" +
    "u AS (\n" +
    "  SELECT " + (unit === "patient" ? "samp.puid" : "sg2.suid") + " AS k, ifNull(grp.g, '') AS g, any(ifNull(grp.label, '')) AS label, sg2.gene AS gene,\n" +
    "         arrayDistinct(arrayFlatten(groupArray(sg2.types))) AS types\n" +
    "  FROM sg2 JOIN samp ON samp.suid = sg2.suid LEFT JOIN grp ON grp.suid = sg2.suid\n" +
    "  GROUP BY k, g, gene\n" +
    "),\n" +
    // the whole cohort, each unit once however many groups it is in: grp '' is reserved for it below
    "uall AS (SELECT k, '\\x01all' AS g, '' AS label, gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM u GROUP BY k, gene),\n" +
    "uu AS (SELECT k, g, label, gene, types FROM u UNION ALL SELECT k, g, label, gene, types FROM uall)\n" +
    "SELECT g AS grp, gene, any(label) AS label, count() AS profiled,\n" +
    "       countIf(length(types) > 0) AS altered,\n" +
    "       countIf(types = ['mutation']) AS mutation, countIf(types = ['amp']) AS amp,\n" +
    "       countIf(types = ['homdel']) AS homdel, countIf(types = ['sv']) AS sv,\n" +
    "       countIf(length(types) > 1) AS multiple\n" +
    "FROM uu GROUP BY grp, gene"
  );
}

/** Each group's units (samples, or patients with a sample in the group), profiled or not, and how many
 *  were profiled for mutations, copy number and structural variants at all — the portal's "+" rows. */
export function cancerTypeSamplesSql(cohortSql: string, study: string, db: string, attribute: string | null, unit: "sample" | "patient" = "sample"): string {
  const fold = clinicalValueFoldSql("attribute_value");
  const k = unit === "patient" ? "samp.puid" : "samp.suid";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "prof AS (\n" +
    "  SELECT sample_unique_id AS suid, groupUniqArray(alteration_type) AS types FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
    ")\n" +
    "SELECT " + (attribute ? "ifNull(grp.g, '')" : sq(study)) + " AS grp, uniqExact(" + k + ") AS samples,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'MUTATION_EXTENDED')) AS mut,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'COPY_NUMBER_ALTERATION')) AS cna,\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'STRUCTURAL_VARIANT')) AS sv\n" +
    "FROM samp LEFT JOIN prof ON prof.suid = samp.suid\n" +
    (attribute
      ? "LEFT JOIN (\n" +
        "  SELECT sample_unique_id AS suid, any(" + fold + ") AS g FROM " + clinicalTable(db, [attribute]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(attribute) + "\n" +
        "    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid\n" +
        ") grp ON grp.suid = samp.suid\n"
      : "") +
    "GROUP BY grp\n" +
    // the whole cohort, each unit once
    "UNION ALL SELECT '\\x01all' AS grp, uniqExact(" + k + "), uniqExactIf(" + k + ", has(prof.types, 'MUTATION_EXTENDED')),\n" +
    "       uniqExactIf(" + k + ", has(prof.types, 'COPY_NUMBER_ALTERATION')), uniqExactIf(" + k + ", has(prof.types, 'STRUCTURAL_VARIANT'))\n" +
    "FROM samp LEFT JOIN prof ON prof.suid = samp.suid"
  );
}

// ---------------------------------------------------------------------------
// overlap: how several cohorts' patients intersect

/**
 * Per membership pattern — a bitmask, bit i set when the patient is in cohort i — how many of the
 * study's patients in any of the cohorts have exactly that pattern. 2^k − 1 counts at most, and
 * nothing else; the caller names each bit.
 */
export function overlapCountsSql(cohortSqls: string[], study: string, db: string): string {
  if (!cohortSqls.length) throw new Error("overlapCountsSql needs at least one cohort");
  const ctes = cohortSqls.map((c, i) => "c" + i + " AS (" + c + ")").join(",\n");
  const union = cohortSqls.map((_, i) => "SELECT pid FROM c" + i).join(" UNION DISTINCT ");
  const mask = cohortSqls.map((_, i) => "(pid IN (SELECT pid FROM c" + i + ")) * " + (1 << i)).join(" + ");
  // each patient's samples ride along, so the same patterns are counted in samples too
  return "WITH " + ctes + ",\nu AS (" + union + "),\nm AS (SELECT pid, " + mask + " AS mask FROM u),\n" +
    "s AS (SELECT " + pidOf("patient_unique_id", study) + " AS pid, count() AS ns FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM u) GROUP BY pid)\n" +
    "SELECT mask, count() AS n, sum(s.ns) AS samples FROM m LEFT JOIN s ON s.pid = m.pid GROUP BY mask ORDER BY n DESC";
}

// ---------------------------------------------------------------------------
// enrichment: every gene's alteration frequency in a cohort, for one alteration type

export type EnrichAlteration = "mutation" | "cna" | "amp" | "homdel" | "sv";
const ENRICH_PANEL_TYPE: Record<EnrichAlteration, string> = {
  mutation: "MUTATION_EXTENDED", cna: "COPY_NUMBER_ALTERATION", amp: "COPY_NUMBER_ALTERATION", homdel: "COPY_NUMBER_ALTERATION", sv: "STRUCTURAL_VARIANT"
};
const enrichEventCond = (a: EnrichAlteration): string =>
  a === "mutation" ? "g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'"
  : a === "sv" ? "g.variant_type = 'structural_variant'"
  : a === "amp" ? "g.variant_type = 'cna' AND g.cna_alteration >= 2"
  : a === "homdel" ? "g.variant_type = 'cna' AND g.cna_alteration <= -2"
  : "g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2";

/** Per gene: the cohort's samples with that alteration type in it (uncalled mutations excluded, as the
 *  portal's gene tables exclude them; high-level copy number only). Counts only. */
export function enrichAlteredSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration, pin: string | null, driver: boolean): string {
  const pid = pidOf("g.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered\n" +
    "FROM " + db + ".genomic_event_derived g\n" +
    (driver && pin ? driverJoin(pin) : "") +
    "WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(alteration) + "\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)" + (driver && pin ? " AND ann.is_driver" : "") + "\n" +
    "GROUP BY gene"
  );
}

/** Per gene: the cohort's samples on a (non-WES) panel covering it for that alteration type — samples
 *  are counted per panel first and the panels then joined to their genes, Explore's own construction
 *  (distinct samples, never rows: a study with two CNA profiles lists each sample twice). */
export function enrichPanelProfiledSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration): string {
  const covPid = pidOf("sd.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "pc AS (\n" +
    "  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[alteration]) + "\n" +
    "    AND sp.gene_panel_id != 'WES' AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY panel\n" +
    ")\n" +
    "SELECT gptg.gene AS gene, sum(pc.n) AS profiled\n" +
    "FROM " + db + ".gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id\n" +
    "GROUP BY gene"
  );
}

/** The cohort's whole-exome samples for that alteration type: profiled for every gene, so one number. */
export function enrichWesSql(cohortSql: string, study: string, db: string, alteration: EnrichAlteration): string {
  const covPid = pidOf("sd.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT uniqExact(sp.sample_unique_id) AS n\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[alteration]) + "\n" +
    "  AND sp.gene_panel_id = 'WES' AND " + covPid + " IN (SELECT pid FROM cohort)"
  );
}

// ---------------------------------------------------------------------------
// assays: a generic-assay profile's every entity, compared between cohorts

/** The profile's data type as the study declared it (LIMIT-VALUE, CATEGORICAL, BINARY, …). Metadata only. */
export function assayProfileSql(study: string, db: string, profileType: string): string {
  return "SELECT datatype, generic_assay_type, ifNull(patient_level, 0) AS patient_level, name FROM " + db + ".genetic_profile\n" +
    "WHERE stable_id = " + sq(study + "_" + profileType) + " AND genetic_alteration_type = 'GENERIC_ASSAY'";
}

/** The cohort's rows of one generic-assay profile. The profile type is the table's leading sort
 *  key, so only that profile's rows are read; the study's own profile id then picks its slice. */
function assayRowsCte(cohortSql: string, study: string, db: string, profileType: string): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "rows AS (\n" +
    "  SELECT entity_stable_id AS entity, value FROM " + db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(profileType) + "\n" +
    "    AND profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "    AND patient_unique_id IN (SELECT concat(" + sq(study + "_") + ", pid) FROM cohort)\n" +
    ")"
  );
}

/** Per entity, over the cohort's samples (or patients, for a patient-level assay): n, Σv and Σv² of
 *  the values that read as numbers, and how many did not (a limit value like ">10", or NA). */
export function assayMomentsSql(cohortSql: string, study: string, db: string, profileType: string): string {
  return (
    assayRowsCte(cohortSql, study, db, profileType) + "\n" +
    "SELECT entity, countIf(isFinite(toFloat64OrNull(value))) AS n,\n" +
    "       sumIf(toFloat64OrNull(value), isFinite(toFloat64OrNull(value))) AS sx,\n" +
    "       sumIf(pow(toFloat64OrNull(value), 2), isFinite(toFloat64OrNull(value))) AS sxx,\n" +
    "       countIf(NOT isFinite(ifNull(toFloat64OrNull(value), nan))) AS other\n" +
    "FROM rows GROUP BY entity"
  );
}

/** Per entity and value: how many of the cohort's samples (or patients) take it. Counts only. */
export function assayValueCountsSql(cohortSql: string, study: string, db: string, profileType: string): string {
  return assayRowsCte(cohortSql, study, db, profileType) + "\nSELECT entity, value, count() AS n FROM rows GROUP BY entity, value";
}

/** Display names for a profile's entities, where the study gave them (NAME). Metadata only: an
 *  entity is a signature, an arm or a compound, never a patient. */
export function assayEntityNamesSql(study: string, db: string, profileType: string): string {
  return "WITH named AS (\n" +
    "  SELECT ge.stable_id AS entity, p.value AS name FROM " + db + ".generic_entity_properties p\n" +
    "  JOIN " + db + ".genetic_entity ge ON ge.id = p.genetic_entity_id\n" +
    "  WHERE p.name = 'NAME' AND ge.stable_id IN (SELECT DISTINCT entity_stable_id FROM " + db + ".generic_assay_data_derived\n" +
    "    WHERE profile_type = " + sq(profileType) + " AND profile_stable_id = " + sq(study + "_" + profileType) + ")\n" +
    ")\nSELECT entity, name FROM named";
}

// ---------------------------------------------------------------------------
// composition: parts of a whole per case (lib/composition.ts builds the vectors)

/**
 * Over the cohort's cases that have every part: n, and per part (arrays in part order) Σp and Σp²
 * of the values compared; Σh and Σh² of each case's Shannon entropy; and how many cases were left
 * out — with only some of the parts, or with a part below zero or none above. One row of sums: the
 * vectors are built and summed inside the database.
 */
export function compositionMomentsSql(cohortSql: string, study: string, db: string, s: CompositionSource): string {
  const k = s.parts.length;
  return casesCte(s, study, db, cohortSql) +
    "SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,\n" +
    "       (SELECT countIf(k < " + k + ") FROM raw) AS incomplete,\n" +
    "       (SELECT countIf(k = " + k + " AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid\n" +
    "FROM cases";
}

/** A generic-assay profile's entities, in id order. Metadata: an entity is a cell type or a
 *  signature, never a case. */
export function compositionEntitiesSql(study: string, db: string, profileType: string): string {
  return "WITH entities AS (\n" +
    "  SELECT DISTINCT entity_stable_id AS entity FROM " + db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(profileType) + " AND profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    ")\nSELECT entity FROM entities ORDER BY entity";
}

// ---------------------------------------------------------------------------
// correlates: one gene's expression against every gene's, genome-wide

/**
 * Per GENE, over the cohort's patients with a value for both it and the query gene (each the mean
 * of the patient's samples, as profileMomentsSql takes it): the six sums Pearson's r needs, n, Σx,
 * Σy, Σxy, Σx², Σy² — and the same six over the two values' average ranks among those patients,
 * which is Spearman's ρ. x is the query gene on `profileType`; y every gene on `otherProfile`
 * (the same profile unless given). Sums only: ranks and values never leave the database.
 */
export function correlatesMomentsSql(cohortSql: string, study: string, db: string, gene: string, profileType: string, otherProfile: string): string {
  const pid = pidOf("sd.patient_unique_id", study);
  const raw = finiteSql("ga.alteration_value");
  const vals = (pt: string, geneCond: string) =>
    "  SELECT " + pid + " AS pid, ga.hugo_gene_symbol AS gene, avg(" + raw + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived ga\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "  WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(pt) + geneCond + "\n" +
    "    AND " + raw + " IS NOT NULL AND isFinite(" + raw + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid, gene\n";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "q AS (\n" + vals(profileType, " AND ga.hugo_gene_symbol = " + sq(gene)) + "),\n" +
    "o AS (\n" + vals(otherProfile, "") + "),\n" +
    "paired AS (SELECT o.gene AS gene, q.v AS x, o.v AS y FROM o INNER JOIN q ON q.pid = o.pid),\n" +
    // average rank among tied values: the first rank of the tie plus half its width
    "ranked AS (\n" +
    "  SELECT gene, x, y,\n" +
    "         rank() OVER (PARTITION BY gene ORDER BY x) + (count() OVER (PARTITION BY gene, x) - 1) / 2 AS rx,\n" +
    "         rank() OVER (PARTITION BY gene ORDER BY y) + (count() OVER (PARTITION BY gene, y) - 1) / 2 AS ry\n" +
    "  FROM paired\n" +
    ")\n" +
    "SELECT gene, count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy,\n" +
    "       sum(rx) AS rsx, sum(ry) AS rsy, sum(rx * ry) AS rsxy, sum(rx * rx) AS rsxx, sum(ry * ry) AS rsyy\n" +
    "FROM ranked GROUP BY gene"
  );
}

/** Each gene's cytoband in the study's own reference genome (the portal's Cytoband column). Metadata only. */
export function geneCytobandsSql(genes: string[], study: string, db: string): string {
  return "SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM " + db + ".gene g\n" +
    "JOIN " + db + ".reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id\n" +
    "WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "  AND g.hugo_gene_symbol IN (" + (genes.length ? genes.map(sq).join(",") : "''") + ")\n" +
    "GROUP BY gene";
}

// ---------------------------------------------------------------------------
// riskmodel: an elastic-net Cox ensemble over the cohort's mutated genes (lib/coxnet.ts)

export interface RiskmodelRowsOpts {
  endpoint: string;
  columns?: { months: string; status: string };
  /** a clinical attribute giving each patient a stratum (patient value, or the first sample's) */
  strata?: string | null;
  /** clinical attributes returned as c0, c1, … (patient value, or the first sample's) */
  covariates?: string[];
  /** count only OncoKB drivers, at this pin */
  driverPin?: string | null;
  /** re-anchor the clock at a timeline event, with the delayed entry that implies */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" } | null;
  /** Table 1's clinical attributes, returned as d0, d1, … (the folded value: the patient's, or the
   *  first sample's), r0, r1, … (that value as spelled) and u0, u1, … (how many distinct folded
   *  values the patient's samples hold) */
  describe?: string[];
}

/**
 * One row per patient of the cohort with a survival time: months and event (from the anchor, with
 * `entry` its offset to the study's day 0, when one is given; `anchored` 0 for a patient without
 * the anchor event), the gene panels their samples were sequenced on for mutations, the genes
 * mutated in them (OncoKB drivers only with `driverPin`), their stratum and covariate values, and
 * which half of the engine's fixed held-out split they are in (`half`, the split leaf's own
 * expression), in patient-id order. Values only: the patient id joins and orders the rows and is
 * never returned. Run only through PatientLevelResolver.viewRows, since a model of individual
 * patients needs their rows.
 */
export function riskmodelRowsSql(cohortSql: string, study: string, db: string, o: RiskmodelRowsOpts): string {
  const { endpoint, columns, strata = null, covariates = [], driverPin = null, anchor = null, describe = [] } = o;
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  for (const a of [strata, ...covariates, ...describe]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  const pid = pidOf("patient_unique_id", study);
  const attrs = [...(strata ? [strata] : []), ...covariates];
  const pick = anchor?.occurrence === "LAST" ? "max" : "min";
  const anchorAttr = anchor?.key
    ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data\n" +
      "        WHERE " + foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n"
    : "";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + finiteSql("anyIf(attribute_value, attribute_name=" + sq(months) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status,\n" +
    "         " + splitBucketSql(pid, study) + " AS half\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "panels AS (\n" +
    "  SELECT " + pidOf("sd.patient_unique_id", study) + " AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + pidOf("sd.patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + pidOf("g.patient_unique_id", study) + " AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driverPin ? driverJoin(driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND " + ALTERED_COND + "\n" +
    (driverPin ? "    AND ann.is_driver = 1\n" : "") +
    "    AND " + pidOf("g.patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")" +
    (attrs.length ?
      ",\nattrs AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      attrs.map((a, k) => "         argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(a) + ") AS a" + k).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, attrs) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") +
    (anchor ?
      ",\nanch AS (\n" +
      "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day, 1 AS hit\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
      "    AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" + anchorAttr +
      "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") +
    (describe.length ?
      ",\ndescr AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      describe.map((a, k) => {
        const is = "attribute_name = " + sq(a), fold = clinicalValueFoldSql("attribute_value");
        return "         argMinIf(" + fold + ", sample_unique_id, " + is + ") AS d" + k + ", argMinIf(attribute_value, sample_unique_id, " + is + ") AS r" + k +
          ", uniqExactIf(" + fold + ", " + is + ") AS u" + k;
      }).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, describe) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + describe.map(sq).join(",") + ") AND trimBoth(attribute_value) != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes" +
    (strata ? ", attrs.a0 AS stratum" : "") +
    covariates.map((_, k) => ", attrs.a" + (k + (strata ? 1 : 0)) + " AS c" + k).join("") +
    (anchor ? ", anch.hit AS anchored, round(anch.day / 30.4375, 4) AS anchor_months" : "") +
    describe.map((_, k) => ", descr.d" + k + " AS d" + k + ", descr.r" + k + " AS r" + k + ", descr.u" + k + " AS u" + k).join("") + "\n" +
    "FROM os\n" +
    "  LEFT JOIN panels ON panels.pid = os.pid\n" +
    "  LEFT JOIN mut ON mut.pid = os.pid\n" +
    (attrs.length ? "  LEFT JOIN attrs ON attrs.pid = os.pid\n" : "") +
    (anchor ? "  LEFT JOIN anch ON anch.pid = os.pid\n" : "") +
    (describe.length ? "  LEFT JOIN descr ON descr.pid = os.pid\n" : "") +
    "WHERE os.months IS NOT NULL AND os.months > 0\n" +
    // a fixed order: the ensemble's seeded splits are drawn over row positions, so the same
    // document gives the same model only if the rows come back in the same order. The id orders
    // the rows inside the database and is not returned.
    "ORDER BY os.pid"
  );
}

/** The genes on each mutation panel this study uses (study metadata; no cohort, no patient). */
export function riskmodelPanelGenesSql(study: string, db: string): string {
  return (
    "SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes\n" +
    "FROM " + db + ".gene_panel_to_gene_derived pg\n" +
    "WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM " + db + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type = 'MUTATION_EXTENDED')\n" +
    "GROUP BY panel"
  );
}

// ---------------------------------------------------------------------------
// txendpoints: real-world treatment endpoints from a treatment anchor

/** Days per month on the timeline clock: OS_MONTHS × this is the last follow-up's timeline day. */
export const DAYS_PER_MONTH = 30.4375;
/** a timeline event this many days past OS_MONTHS × DAYS_PER_MONTH says the two clocks disagree */
export const CLOCK_SLACK_DAYS = 31;

export interface TxEndpointOpts {
  endpoint: "ttnt" | "tot" | "rwpfs" | "os";
  /** the anchored treatment (event type, optional key = value; the first or last such record) */
  anchor: IncidenceAnchor;
  /** how records form lines (lib/treatment-lines.ts) */
  lines: LineSpec;
  /** rwpfs: the progression event — its type, key and accepted values, and an optional probability floor */
  progression?: ProgressionEvent;
  /** tot: a stop this many days or fewer before the last follow-up of a living patient counts as ongoing */
  ongoingDays?: number;
}

/** Timeline events of the study's cohort patients, aliased `alias` (the FROM … WHERE of a CTE). */
function cohortEventsFrom(db: string, study: string, alias: string): string {
  return "  FROM " + db + ".clinical_event " + alias + "\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = " + alias + ".patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND p.stable_id IN (SELECT pid FROM cohort)\n";
}

/** an event of `alias` carrying `key` (folded) with a value meeting `valueCond` */
function eventHasKv(db: string, alias: string, key: string, valueCond: string): string {
  return "    AND " + alias + ".clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
    foldedEqualsSql("key", key) + " AND " + valueCond + ")\n";
}

/** the progression event: its type, key and accepted values, and an optional probability floor */
export interface ProgressionEvent { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number }

/** `os`: each cohort patient's OS_MONTHS (months) and whether OS_STATUS says deceased (dead) */
function osCte(study: string, db: string): string {
  const pid = pidOf("patient_unique_id", study);
  return "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")";
}

/** `lastday`: each cohort patient's latest timeline day (a start or a stop) — the clock check's input */
function lastDayCte(study: string, db: string): string {
  return "lastday AS (\n" +
    "  SELECT p.stable_id AS pid, max(greatest(ce.start_date, coalesce(ce.stop_date, ce.start_date))) AS d\n" + cohortEventsFrom(db, study, "ce") +
    "  GROUP BY pid\n" +
    ")";
}

/** `prog`: (pid, day) of every progression event of the cohort's patients */
function progressionCte(study: string, db: string, pr: ProgressionEvent): string {
  return "prog AS (\n" +
    "  SELECT p.stable_id AS pid, ce.start_date AS day\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", pr.eventType) + "\n" +
    eventHasKv(db, "ce", pr.key, foldedInSql("value", pr.values)) +
    (pr.probabilityKey && pr.minProbability != null
      ? eventHasKv(db, "ce", pr.probabilityKey, "toFloat64OrNull(value) >= " + Number(pr.minProbability)) : "") +
    ")";
}

/**
 * Per cohort, counts of (entry, t, ev) in months from the anchored treatment's start (day `a`): the
 * time to the endpoint (`ev` 1) or to censoring at the last follow-up (`ev` 0), the last follow-up
 * being day OS_MONTHS × DAYS_PER_MONTH of the timeline clock and death (OS_STATUS 1:…) an event for
 * every endpoint. `entry` is the delay from the anchor to day 0 when the anchor precedes it — the
 * left truncation of the survival and incidence views.
 *   ttnt   the start of the next treatment line after the anchor's (lines as lib/treatment-lines.ts
 *          builds them; for an anchor no line holds, the first line starting after it), or death
 *   tot    the latest stop of the anchored records in the anchor's line (or, outside a line, those
 *          starting on day `a`), or death; a living patient whose stop lies within `ongoingDays` of
 *          the last follow-up is censored there as still on it
 *   rwpfs  the first progression event after day `a`, or death
 *   os     death alone (overall survival from the anchor; `lines` is not read)
 * Patients who cannot enter are counted under `kind`: 'nofollowup' (no OS, or follow-up ending at
 * or before the anchor) and, for tot, 'nostop' (an anchored record of the line without a stop
 * date). `late` flags patients with a timeline event more than CLOCK_SLACK_DAYS past their last
 * follow-up — the check that the timeline and OS_MONTHS share day 0. A cohort patient with no
 * anchored record is in no row; the caller counts them from the cohort's size.
 */
export function txEndpointCountsSql(cohortSql: string, study: string, db: string, o: TxEndpointOpts): string {
  const pick = o.anchor.occurrence === "LAST" ? "max" : "min";
  const evFrom = (alias: string) => cohortEventsFrom(db, study, alias);
  const hasKv = (alias: string, key: string, valueCond: string) => eventHasKv(db, alias, key, valueCond);
  const ctes: string[] = [
    osCte(study, db),
    "arec AS (\n" +
    "  SELECT p.stable_id AS pid, ce.clinical_event_id AS eid, ce.start_date AS s, ce.stop_date AS e\n" + evFrom("ce") +
    "    AND " + foldedEqualsSql("ce.event_type", o.anchor.eventType) + "\n" +
    (o.anchor.key ? hasKv("ce", o.anchor.key, foldedEqualsSql("value", String(o.anchor.value ?? ""))) : "") +
    ")",
    "anch AS (SELECT pid, " + pick + "(s) AS a FROM arec GROUP BY pid)",
    lastDayCte(study, db),
  ];
  let x: string;
  if (o.endpoint === "os") {
    ctes.push("x AS (SELECT pid, toInt64(0) AS d, 0 AS nostop FROM anch WHERE 0)");
    x = "x";
  } else if (o.endpoint === "rwpfs") {
    ctes.push(
      progressionCte(study, db, o.progression!),
      "x AS (SELECT prog.pid AS pid, min(prog.day) AS d, 0 AS nostop FROM prog INNER JOIN anch ON anch.pid = prog.pid WHERE prog.day > anch.a GROUP BY prog.pid)");
    x = "x";
  } else {
    ctes.push(...linesCtes({ db, study, patientFilter: "p.stable_id IN (SELECT pid FROM cohort)", spec: o.lines }),
      // the anchor's line: the line of a record that is anchored and starts on day a
      "aline AS (\n" +
      "  SELECT n.pid AS pid, min(n.line_no) AS ln FROM numbered n\n" +
      "  INNER JOIN arec ON arec.eid = n.eid INNER JOIN anch ON anch.pid = n.pid\n" +
      "  WHERE arec.s = anch.a GROUP BY n.pid\n" +
      ")");
    if (o.endpoint === "ttnt") {
      ctes.push(
        "x AS (\n" +
        "  SELECT anch.pid AS pid, minIf(l.ls, if(al.pid != '', l.line_no > al.ln, l.ls > anch.a)) AS d,\n" +
        "         countIf(if(al.pid != '', l.line_no > al.ln, l.ls > anch.a)) AS k, 0 AS nostop\n" +
        "  FROM anch LEFT JOIN aline al ON al.pid = anch.pid INNER JOIN lines l ON l.pid = anch.pid\n" +
        "  GROUP BY anch.pid HAVING k > 0\n" +
        ")");
    } else {
      ctes.push(
        "x AS (\n" +
        "  SELECT anch.pid AS pid, max(arec.e) AS d, countIf(arec.e IS NULL) AS nostop\n" +
        "  FROM anch INNER JOIN arec ON arec.pid = anch.pid\n" +
        "  LEFT JOIN aline al ON al.pid = anch.pid LEFT JOIN numbered n ON n.eid = arec.eid\n" +
        "  WHERE arec.s >= anch.a AND if(al.pid != '', n.line_no = al.ln, arec.s = anch.a)\n" +
        "  GROUP BY anch.pid\n" +
        ")");
    }
    x = "x";
  }
  const ongoing = Math.max(0, Math.floor(Number(o.ongoingDays ?? 30)));
  ctes.push(
    "per AS (\n" +
    "  SELECT anch.a AS a, os.months * " + DAYS_PER_MONTH + " AS fu, os.months IS NOT NULL AS has_os, os.dead AS dead,\n" +
    "         " + x + ".pid != '' AS has_x, toFloat64(" + x + ".d) AS xd, " + x + ".nostop AS nostop, lastday.d AS ld\n" +
    "  FROM anch\n" +
    "  LEFT JOIN os ON os.pid = anch.pid\n" +
    "  LEFT JOIN " + x + " ON " + x + ".pid = anch.pid\n" +
    "  LEFT JOIN lastday ON lastday.pid = anch.pid\n" +
    ")",
    "cls AS (\n" +
    "  SELECT multiIf(NOT has_os OR fu - a <= 0, 'nofollowup',\n" +
    (o.endpoint === "tot" ? "                 NOT has_x OR nostop > 0 OR xd IS NULL, 'nostop',\n" : "") +
    "                 'record') AS kind,\n" +
    "         greatest(0, -a) / " + DAYS_PER_MONTH + " AS entry,\n" +
    (o.endpoint === "tot"
      ? "         (least(xd, fu) - a) / " + DAYS_PER_MONTH + " AS tt,\n" +
        "         if(NOT dead AND xd + " + ongoing + " >= fu, 0, 1) AS ev,\n"
      : "         has_x AND xd <= fu AS hit,\n" +
        "         if(hit, xd - a, fu - a) / " + DAYS_PER_MONTH + " AS tt,\n" +
        "         if(hit, 1, if(dead, 1, 0)) AS ev,\n") +
    "         ld > fu + " + CLOCK_SLACK_DAYS + " AS late\n" +
    "  FROM per\n" +
    ")");
  return "WITH cohort AS (" + cohortSql + "),\n" + ctes.join(",\n") + "\n" +
    "SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(tt, 4), 0) AS t,\n" +
    "       if(kind = 'record', ev, 0) AS ev, late, count() AS n\n" +
    "FROM cls GROUP BY kind, entry, t, ev, late ORDER BY t";
}

// ---------------------------------------------------------------------------
// multistate: the illness–death model (start → progression → death) from the timeline's day 0

/** the event type whose day-0 record says the timeline's clock starts at sequencing */
export const SEQUENCING_EVENT = "Sequencing";

/**
 * Per cohort, counts of patient paths through the illness–death model on the timeline's clock, in
 * months from day 0: `prevalent` (a progression event on or before day 0, so the patient starts in
 * the progression state), `tp` the first progression after day 0 strictly before the end of
 * follow-up (0 when none), `te` the end of follow-up — OS_MONTHS, the timeline's last follow-up
 * day being OS_MONTHS × DAYS_PER_MONTH — and `dead` (OS_STATUS 1:…). Flags beside them, for the
 * caveat: `afterend` a progression recorded only on or after the end of follow-up (not counted),
 * `assessed` any record of the progression key at all (a patient never imaged cannot show
 * progression), `seq0` a Sequencing event on day 0 (what day 0 is), and `late` a timeline event
 * more than CLOCK_SLACK_DAYS past the end of follow-up (the clock check). 'nofollowup' patients
 * (no OS, or OS_MONTHS ≤ 0) are counted apart. Every cohort patient is in exactly one row's n.
 */
export function multistateCountsSql(cohortSql: string, study: string, db: string, pr: ProgressionEvent): string {
  return "WITH cohort AS (" + cohortSql + "),\n" + [
    osCte(study, db),
    lastDayCte(study, db),
    progressionCte(study, db, pr),
    "pp AS (SELECT pid, countIf(day <= 0) AS n_pre, countIf(day > 0) AS n_after, minIf(day, day > 0) AS first_after FROM prog GROUP BY pid)",
    "assessed AS (\n" +
    "  SELECT DISTINCT p.stable_id AS pid\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", pr.eventType) + "\n" +
    eventHasKv(db, "ce", pr.key, "1") +
    ")",
    "seq0 AS (\n" +
    "  SELECT DISTINCT p.stable_id AS pid\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", SEQUENCING_EVENT) + " AND ce.start_date = 0\n" +
    ")",
    "per AS (\n" +
    "  SELECT os.months AS months, os.months IS NOT NULL AS has_os, os.dead AS dead,\n" +
    "         pp.pid != '' AND pp.n_pre > 0 AS prevalent, pp.pid != '' AND pp.n_after > 0 AS has_after, toFloat64(pp.first_after) AS fa,\n" +
    "         a.pid != '' AS assessed, s.pid != '' AS seq0, lastday.d AS ld\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c\n" +
    "  LEFT JOIN os ON os.pid = c.pid\n" +
    "  LEFT JOIN pp ON pp.pid = c.pid\n" +
    "  LEFT JOIN assessed a ON a.pid = c.pid\n" +
    "  LEFT JOIN seq0 s ON s.pid = c.pid\n" +
    "  LEFT JOIN lastday ON lastday.pid = c.pid\n" +
    ")",
    "cls AS (\n" +
    "  SELECT multiIf(NOT has_os OR months <= 0, 'nofollowup', 'record') AS kind,\n" +
    "         NOT prevalent AND has_after AND fa < months * " + DAYS_PER_MONTH + " AS hit,\n" +
    "         NOT prevalent AND has_after AND fa >= months * " + DAYS_PER_MONTH + " AS afterend,\n" +
    "         if(hit, fa / " + DAYS_PER_MONTH + ", 0) AS tp, months AS te,\n" +
    "         prevalent, dead, assessed, seq0, ld > months * " + DAYS_PER_MONTH + " + " + CLOCK_SLACK_DAYS + " AS late\n" +
    "  FROM per\n" +
    ")",
  ].join(",\n") + "\n" +
    "SELECT kind, if(kind = 'record', toUInt8(prevalent), 0) AS prevalent, if(kind = 'record', round(tp, 4), 0) AS tp,\n" +
    "       if(kind = 'record', round(te, 4), 0) AS te, if(kind = 'record', toUInt8(dead), 0) AS dead,\n" +
    "       toUInt8(afterend) AS afterend, toUInt8(assessed) AS assessed, toUInt8(seq0) AS seq0, toUInt8(late) AS late, count() AS n\n" +
    "FROM cls GROUP BY kind, prevalent, tp, te, dead, afterend, assessed, seq0, late ORDER BY te";
}

// ---------------------------------------------------------------------------
// cutpoint: a numeric marker against a survival endpoint, per patient

/**
 * One row per cohort patient with a survival time: months `m`, event `ev`, the marker `v` — the
 * patient's value, or for a sample attribute the value of the patient's first sample by sample id
 * — and, with `stratum`, that attribute's value read the same way as `s`. Values only, in no
 * particular order: the patient id joins the CTEs and is never returned. Run only through
 * PatientLevelResolver.viewRows, since a permutation test needs each patient's pair.
 */
export function cutpointRowsSql(cohortSql: string, study: string, db: string,
  o: { attribute: string; months: string; status: string; stratum?: string | null }): string {
  for (const a of [o.attribute, o.stratum, o.months, o.status]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  const attrs = [o.attribute, ...(o.stratum ? [o.stratum] : [])];
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = " + sq(o.months) + ")) AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(o.status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [o.months, o.status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN (" + sq(o.months) + ", " + sq(o.status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "val AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         toFloat64OrNull(argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(o.attribute) + ")) AS v" +
    (o.stratum ? ",\n         argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = " + sq(o.stratum) + ") AS s" : "") + "\n" +
    "  FROM " + clinicalTable(db, attrs) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + attrs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, val.v AS v" + (o.stratum ? ", val.s AS s" : "") + "\n" +
    "FROM os LEFT JOIN val ON val.pid = os.pid\n" +
    "WHERE os.months IS NOT NULL AND os.months >= 0"
  );
}
// hla: HLA class I genotype and HLA LOH per patient

export interface HlaRowsOpts {
  /** per locus A, B, C: the attributes that may hold its first allele, its second, or both as one "x/y" value */
  loci: { first: string[]; second: string[]; pair: string[] }[];
  /** allele-name fields compared (1, 2, or 99 for all) */
  fields: number;
  lohAttributes: string[]; lohValues: string[];
  months: string; status: string;
  covariates: string[];
}

/** an allele's name as its fields: hla_a_02_01_01_01, A*02:01 and A0201 all start ["02", "01"] */
const hlaFieldsSql = (x: string) => {
  const y = "replaceRegexpOne(lowerUTF8(" + x + "), '^(hla[-_]?)?[abc][*_]?', '')";
  return "if(match(" + y + ", '[_:]'), splitByRegexp('[_:]', " + y + "), [substring(" + y + ", 1, 2), substring(" + y + ", 3)])";
};

/**
 * One row per patient of the cohort: per locus whether its two alleles match at `fields` fields
 * (hA, hB, hC; NULL when either allele is missing), the fewest fields any allele was typed at (nf),
 * HLA LOH in any sample (loss; NULL when no sample has a call), the endpoint (m, ev) and each
 * covariate as c0, c1, … (the patient's, or the first sample's). Values only: the patient id joins
 * the CTEs and is never returned. Run only through PatientLevelResolver.viewRows.
 */
export function hlaRowsSql(cohortSql: string, study: string, db: string, o: HlaRowsOpts): string {
  const names = [...o.loci.flatMap((l) => [...l.first, ...l.second, ...l.pair]), ...o.lohAttributes, o.months, o.status, ...o.covariates];
  for (const a of names) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  const inList = (xs: string[]) => xs.length ? "k IN (" + xs.map(sq).join(", ") + ")" : "0";
  const allele = (l: HlaRowsOpts["loci"][number], i: 1 | 2) => {
    const own = "anyIf(v, " + inList(i === 1 ? l.first : l.second) + ")";
    return "if(" + own + " != '', " + own + ", splitByRegexp('\\\\s*[/,;]\\\\s*', anyIf(v, " + inList(l.pair) + "))[" + i + "])";
  };
  const genoAttrs = o.loci.flatMap((l) => [...l.first, ...l.second, ...l.pair]);
  const fields = Math.max(1, Math.min(99, Math.floor(o.fields)));
  const key = (x: string) => "arrayStringConcat(arraySlice(" + hlaFieldsSql(x) + ", 1, " + fields + "), ':')";
  const homAt = (i: number) => "if(k[" + (2 * i + 1) + "] = '' OR k[" + (2 * i + 2) + "] = '', NULL, toUInt8(k[" + (2 * i + 1) + "] = k[" + (2 * i + 2) + "]))";
  const covs = o.covariates;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "gt AS (\n" +
    "  SELECT pid, [" + o.loci.flatMap((l) => [allele(l, 1), allele(l, 2)]).join(",\n    ") + "] AS raw\n" +
    "  FROM (SELECT " + pid + " AS pid, attribute_name AS k, trimBoth(attribute_value) AS v FROM " + clinicalTable(db, genoAttrs) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + genoAttrs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "      AND " + pid + " IN (SELECT pid FROM cohort))\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "keys AS (\n" +
    "  SELECT pid, arrayMap(x -> if(x = '', '', " + key("x") + "), raw) AS k,\n" +
    "         arrayMin(arrayMap(x -> if(x = '', 99, length(" + hlaFieldsSql("x") + ")), raw)) AS nf0\n" +
    "  FROM gt\n" +
    "),\n" +
    "hom AS (SELECT pid, " + homAt(0) + " AS hA, " + homAt(1) + " AS hB, " + homAt(2) + " AS hC, toNullable(nf0) AS nf FROM keys),\n" +
    "loh AS (\n" +
    "  SELECT " + pid + " AS pid, toNullable(max(" + clinicalValueFoldSql("attribute_value") + " IN (" + o.lohValues.map((v) => clinicalValueFoldSql(sq(v))).join(", ") + "))) AS loss\n" +
    "  FROM " + clinicalTable(db, o.lohAttributes) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + o.lohAttributes.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = " + sq(o.months) + ")) AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(o.status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [o.months, o.status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN (" + sq(o.months) + ", " + sq(o.status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")" +
    (covs.length
      ? ",\ncov AS (\n" +
        "  SELECT " + pid + " AS pid" + covs.map((c, i) => ",\n         toNullable(argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = " + sq(c) + ")) AS c" + i).join("") + "\n" +
        "  FROM " + clinicalTable(db, covs) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + covs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
        "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid\n" +
        ")\n"
      : "\n") +
    "SELECT hom.hA AS hA, hom.hB AS hB, hom.hC AS hC, hom.nf AS nf, loh.loss AS loss,\n" +
    "       if(os.months >= 0, os.months, NULL) AS m, if(os.status LIKE '1%', 1, 0) AS ev" + covs.map((_, i) => ", cov.c" + i + " AS c" + i).join("") + "\n" +
    "FROM cohort LEFT JOIN hom ON hom.pid = cohort.pid LEFT JOIN loh ON loh.pid = cohort.pid LEFT JOIN os ON os.pid = cohort.pid" +
    (covs.length ? " LEFT JOIN cov ON cov.pid = cohort.pid" : "")
  );
}

/** the attribute names in a study that mention HLA, with how many values each holds */
export function hlaAttributesSql(_cohortSql: string, study: string, db: string): string {
  return "SELECT attribute_name AS name, any(type) AS type, count() AS n FROM " + clinicalTable(db, []) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name ILIKE '%hla%' AND trimBoth(attribute_value) != ''\n" +
    "GROUP BY name ORDER BY name LIMIT 40";
}

// adjusted: each gene's alteration between two cohorts, by logistic regression on covariates

/**
 * One row per patient of the cohort with a mutation panel: the panels their samples were sequenced
 * on, the genes mutated in them (called mutations only; OncoKB drivers only with `driverPin`), and
 * each covariate's value as c0, c1, … (the patient's, or the first sample's). Values only: the
 * patient id joins the CTEs and is never returned. Run only through PatientLevelResolver.viewRows.
 */
export function adjustedRowsSql(cohortSql: string, study: string, db: string, o: { covariates: string[]; driverPin?: string | null }): string {
  const { covariates, driverPin = null } = o;
  for (const a of covariates) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study), sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "panels AS (\n" +
    "  SELECT " + sdPid + " AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + gPid + " AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (driverPin ? driverJoin(driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'\n" +
    (driverPin ? "    AND ann.is_driver = 1\n" : "") +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")" +
    (covariates.length ?
      ",\nattrs AS (\n" +
      "  SELECT " + pid + " AS pid,\n" +
      covariates.map((a, k) => "         argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(a) + ") AS a" + k).join(",\n") + "\n" +
      "  FROM " + clinicalTable(db, covariates) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + covariates.map(sq).join(",") + ") AND trimBoth(attribute_value) != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT panels.panels AS panels, mut.genes AS genes" + covariates.map((_, k) => ", attrs.a" + k + " AS c" + k).join("") + "\n" +
    "FROM panels\n" +
    "  LEFT JOIN mut ON mut.pid = panels.pid\n" +
    (covariates.length ? "  LEFT JOIN attrs ON attrs.pid = panels.pid\n" : "")
  );
}

// ---------------------------------------------------------------------------
// actionability: each patient's highest OncoKB therapeutic level

/** OncoKB's sensitive levels, best first, and the resistance levels; rank 9 is none */
export const SENSITIVE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3A", "LEVEL_3B", "LEVEL_4"] as const;
export const RESISTANCE_LEVELS = ["LEVEL_R1", "LEVEL_R2"] as const;
const rankOf = (col: string, levels: readonly string[]) => "multiIf(" + levels.map((l, i) => col + " = " + sq(l) + ", " + (i + 1)).join(", ") + ", 9)";

/** the cohort's samples sequenced for mutations, and per sample its best sensitive and resistance
 *  rank over its called mutations and high-level copy-number calls (OncoKB at `pin`) */
function actionCtes(cohortSql: string, study: string, db: string, pin: string): string {
  const sdPid = pidOf("sd.patient_unique_id", study);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "seq AS (\n" +
    "  SELECT DISTINCT sp.sample_unique_id AS sid, " + sdPid + " AS pid\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "lv AS (\n" +
    "  SELECT g.sample_unique_id AS sid, min(" + rankOf("ann.highest_sensitive_level", SENSITIVE_LEVELS) + ") AS s,\n" +
    "         min(" + rankOf("ann.highest_resistance_level", RESISTANCE_LEVELS) + ") AS r\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    // the store's rows with a level at the pin only — a few thousand of its millions — matched as driverJoin matches
    "  INNER JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, highest_sensitive_level, highest_resistance_level\n" +
    "      FROM oncokb_annotation.variant_annotation\n" +
    "      WHERE oncokb_version = " + sq(pin) + " AND (highest_sensitive_level != '' OR highest_resistance_level != '')) ann\n" +
    "    ON ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
    "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
    "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
    "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')\n" +
    "    AND g.sample_unique_id IN (SELECT sid FROM seq)\n" +
    "  GROUP BY sid\n" +
    ")"
  );
}

/**
 * Per group (a clinical attribute's value per patient — "Multiple" when their samples disagree,
 * "" when none is recorded — or one group without `groupBy`) and per pair of a patient's best
 * sensitive and resistance ranks over every sequenced sample: the number of patients. Counts only.
 */
export function actionLevelsSql(cohortSql: string, study: string, db: string, pin: string, groupBy: string | null): string {
  if (groupBy && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(groupBy)) throw new Error("bad attribute name '" + String(groupBy).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  return (
    actionCtes(cohortSql, study, db, pin) + ",\n" +
    "pl AS (\n" +
    "  SELECT seq.pid AS pid, min(if(lv.s = 0, 9, lv.s)) AS s, min(if(lv.r = 0, 9, lv.r)) AS r\n" +
    "  FROM seq LEFT JOIN lv ON lv.sid = seq.sid\n" +
    "  GROUP BY pid\n" +
    ")" +
    (groupBy ?
      ",\ngrp AS (\n" +
      "  SELECT " + pid + " AS pid, if(uniqExact(attribute_value) > 1, 'Multiple', any(attribute_value)) AS g\n" +
      "  FROM " + clinicalTable(db, [groupBy]) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(groupBy) + " AND trimBoth(attribute_value) != ''\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid\n" +
      ")" : "") + "\n" +
    "SELECT " + (groupBy ? "grp.g" : "''") + " AS grp, pl.s AS level, pl.r AS resistance, count() AS n\n" +
    "FROM pl" + (groupBy ? " LEFT JOIN grp ON grp.pid = pl.pid" : "") + "\n" +
    "GROUP BY grp, level, resistance"
  );
}

/**
 * Patients with a sequenced sample on each side of a sample attribute (e.g. SAMPLE_TYPE Primary
 * against Metastasis, values matched case-insensitively): per pair of their best sensitive rank
 * on side a and on side b, the number of patients. Counts only.
 */
export function actionConcordanceSql(cohortSql: string, study: string, db: string, pin: string, by: { attribute: string; a: string[]; b: string[] }): string {
  if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(by.attribute)) throw new Error("bad attribute name '" + String(by.attribute).slice(0, 40) + "'");
  const side = (vals: string[]) => "lower(trimBoth(attribute_value)) IN (" + vals.map((v) => sq(String(v).trim().toLowerCase())).join(", ") + ")";
  return (
    actionCtes(cohortSql, study, db, pin) + ",\n" +
    "st AS (\n" +
    "  SELECT sample_unique_id AS sid, multiIf(" + side(by.a) + ", 'a', " + side(by.b) + ", 'b', '') AS side\n" +
    "  FROM " + clinicalTable(db, [by.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(by.attribute) + "\n" +
    "    AND sample_unique_id IN (SELECT sid FROM seq)\n" +
    "),\n" +
    "ps AS (\n" +
    "  SELECT seq.pid AS pid, minIf(if(lv.s = 0, 9, lv.s), st.side = 'a') AS sa, minIf(if(lv.s = 0, 9, lv.s), st.side = 'b') AS sb,\n" +
    "         countIf(st.side = 'a') AS na, countIf(st.side = 'b') AS nb\n" +
    "  FROM seq INNER JOIN st ON st.sid = seq.sid LEFT JOIN lv ON lv.sid = seq.sid\n" +
    "  GROUP BY pid\n" +
    "  HAVING na > 0 AND nb > 0\n" +
    ")\n" +
    "SELECT sa AS a, sb AS b, count() AS n FROM ps GROUP BY a, b"
  );
}

/** The alteration types the store holds a therapeutic level for at `pin` (reference data, no cohort). */
export function actionStoreTypesSql(_study: string, _db: string, pin: string): string {
  return "SELECT toString(alteration_type) AS type, count() AS n FROM oncokb_annotation.variant_annotation\n" +
    "WHERE oncokb_version = " + sq(pin) + " AND (highest_sensitive_level != '' OR highest_resistance_level != '')\nGROUP BY type";
}

// ---------------------------------------------------------------------------
// drivernegative: patients without a driver in a canonical list, against those with one

/** a gene list as SQL literals, checked */
function geneList(genes: string[]): string {
  for (const g of genes) if (!/^[A-Za-z0-9_.-]{1,40}$/.test(g)) throw new Error("bad gene symbol '" + String(g).slice(0, 40) + "'");
  return genes.map(sq).join(", ");
}

/**
 * Each sequenced patient's group: "positive" with an OncoKB driver (mutation, high-level copy
 * number or structural variant) in one of `drivers`; else "negative" when a mutation panel of
 * theirs covers every listed gene (or whole-exome); else "unprofiled". With `type`, also `pp`:
 * each patient's panels for that alteration type and whether one is whole-exome.
 */
function dnegCtes(cohortSql: string, study: string, db: string, pin: string, drivers: string[], type: EnrichAlteration): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study), list = geneList(drivers);
  const panelsOf = (name: string, alterationType: string) => name + " AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(alterationType) + "\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    ")";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    panelsOf("mp", "MUTATION_EXTENDED") + ",\n" +
    panelsOf("pp", ENRICH_PANEL_TYPE[type]) + ",\n" +
    "cov AS (\n" +
    "  SELECT mp.pid AS pid, max(mp.panel = 'WES') AS wes, uniqExactIf(gp.gene, gp.gene IN (" + list + ")) AS ng\n" +
    "  FROM mp LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = mp.panel\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "drv AS (\n" +
    "  SELECT DISTINCT " + gPid + " AS pid\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + driverJoin(pin) +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.hugo_gene_symbol IN (" + list + ") AND ann.is_driver\n" +
    "    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')\n" +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "grp AS (\n" +
    "  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = " + new Set(drivers).size + ", 'negative', 'unprofiled') AS g FROM cov\n" +
    ")"
  );
}

/** Patients per group (positive, negative, unprofiled), of the cohort's patients sequenced for mutations. Counts only. */
export function dnegGroupsSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[]): string {
  return dnegCtes(cohortSql, study, db, pin, drivers, "mutation") + "\nSELECT g AS grp, count() AS n FROM grp GROUP BY grp";
}

/** Per gene outside `drivers` and per group (positive, negative): patients with that alteration in it
 *  (OncoKB drivers only with `driverOnly`). Counts only. */
export function dnegAlteredSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[], alteration: EnrichAlteration, driverOnly: boolean): string {
  const gPid = pidOf("g.patient_unique_id", study);
  return (
    dnegCtes(cohortSql, study, db, pin, drivers, alteration) + "\n" +
    "SELECT g.hugo_gene_symbol AS gene, grp.g AS grp, uniqExact(" + gPid + ") AS altered\n" +
    "FROM " + db + ".genomic_event_derived g\n" + (driverOnly ? driverJoin(pin) : "") +
    "  INNER JOIN grp ON grp.pid = " + gPid + "\n" +
    "WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(alteration) + "\n" +
    "  AND g.hugo_gene_symbol NOT IN (" + geneList(drivers) + ") AND grp.g IN ('positive', 'negative')" + (driverOnly ? " AND ann.is_driver" : "") + "\n" +
    "GROUP BY gene, grp"
  );
}

/** Per gene and group: patients not on whole-exome with a panel covering the gene for that alteration
 *  type; gene '' carries each group's whole-exome patients, profiled for every gene. Counts only. */
export function dnegProfiledSql(cohortSql: string, study: string, db: string, pin: string, drivers: string[], alteration: EnrichAlteration): string {
  return (
    dnegCtes(cohortSql, study, db, pin, drivers, alteration) + ",\n" +
    "pw AS (SELECT pid, max(panel = 'WES') AS wes FROM pp GROUP BY pid)\n" +
    "SELECT if(pw.wes = 1, '', gp.gene) AS gene, grp.g AS grp, uniqExact(pp.pid) AS profiled\n" +
    "FROM pp INNER JOIN pw ON pw.pid = pp.pid INNER JOIN grp ON grp.pid = pp.pid\n" +
    "  LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel\n" +
    "WHERE grp.g IN ('positive', 'negative')\n" +
    "GROUP BY gene, grp"
  );
}

// ---------------------------------------------------------------------------
// organotropism: which genes go with metastasis to which organ

export type OrgSourceKind = "flags" | "timeline" | "sample";
export interface OrgSource {
  kind: OrgSourceKind;
  /** flags: the per-organ attributes' common prefix (e.g. DMETS_DX_), valued Yes / No */
  prefix?: string;
  /** timeline: the event type and the key whose value names the site */
  eventType?: string; key?: string;
  /** sample: the attribute naming a metastasis sample's biopsy site, mapped through ORG_SITE_MAP */
  attribute?: string;
}

/**
 * The organ a free-text biopsy site is counted under: the first rule whose pattern matches the
 * lower-cased value; anything else is "Other". The rules are ours, written against the public
 * METASTATIC_SITE vocabularies (msk_met_2021, msk_chord_2024, msk_impact_50k_2026), and every
 * result lists the values that fell to "Other".
 */
const ORG_SITE_MAP: [string, string][] = [
  ["Lymph node", "lymph|\\bln\\b|node|axilla"],
  ["CNS/Brain", "brain|cereb|csf|epidural|dura\\b|dural|mening|spinal cord|cns"],
  ["Liver", "liver|hepat"],
  ["Lung", "^lung|pulmon|\\blung\\b"],
  ["Pleura", "pleura"],
  ["Bone", "bone|spine|vertebr|\\brib\\b|femur|iliac|sacr|stern|scapula|humer|skull|acetab|clavic|tibia|ischi|pubic|calvari"],
  ["Adrenal gland", "adrenal"],
  ["Peritoneum / abdomen", "periton|omentum|mesenter|abdom|diaphragm|intra-abdominal|ascites"],
  ["Bowel / GI tract", "bowel|colon|rect|intestin|duoden|ileum|jejun|append|stomach|gastr|esophag|biliary|gallbladder|pancrea"],
  ["Skin / soft tissue", "skin|scalp|soft tissue|chest wall|subcut|muscle|\\bback\\b|paraspinal|breast"],
  ["Genital organs", "ovar|uter|vagin|adnex|endomet|cervix|fallop|genital|testi|prostat|vulva"],
  ["Kidney / urinary tract", "kidney|renal|bladder|ureter|urethr|\\but\\b"],
  ["Head and neck", "head|neck|thyroid|parotid|oral|tongue|larynx|orbit"],
  ["Mediastinum / heart", "mediastin|pericard|heart"],
];

/** A biopsy-site value's organ, in SQL (ORG_SITE_MAP's rules over the lower-cased, trimmed value). */
function orgSiteMapSql(expr: string): string {
  const v = "lowerUTF8(trimBoth(" + expr + "))";
  return "multiIf(" + ORG_SITE_MAP.map(([organ, re]) => "match(" + v + ", " + sq(re) + "), " + sq(organ)).join(", ") + ", 'Other')";
}

const orgAttr = (a: string) => { if (!/^[A-Za-z0-9_.-]{1,64}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'"); return a; };
const ORG_YES = "('yes', 'y', 'true', '1')", ORG_NO = "('no', 'n', 'false', '0')";

/**
 * `ps`: one row per (patient, site) the source can speak to, `has` 1 when the patient has a
 * metastasis there; `sl`: each site's label. Flags: a patient is evaluable for a site when its
 * flag is recorded Yes or No. Timeline: a patient with any site recorded is evaluable for every
 * site seen. Sample: every cohort patient is evaluable; a site is one a sample was taken from.
 */
function orgSiteCtes(study: string, db: string, src: OrgSource): string {
  const pid = pidOf("patient_unique_id", study);
  if (src.kind === "flags") {
    const prefix = orgAttr(src.prefix || "DMETS_DX_");
    return (
      "fl AS (\n" +
      "  SELECT " + pid + " AS pid, substring(attribute_name, " + (prefix.length + 1) + ") AS site,\n" +
      "         max(" + clinicalValueFoldSql("attribute_value") + " IN " + ORG_YES + ") AS has,\n" +
      "         max(" + clinicalValueFoldSql("attribute_value") + " IN " + ORG_YES + " OR " + clinicalValueFoldSql("attribute_value") + " IN " + ORG_NO + ") AS known\n" +
      "  FROM " + clinicalTable(db, []) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND startsWith(attribute_name, " + sq(prefix) + ") AND length(attribute_name) > " + prefix.length + "\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid, site\n" +
      "),\n" +
      "ps AS (SELECT pid, site, toUInt8(has) AS has FROM fl WHERE known),\n" +
      "sl AS (SELECT DISTINCT site, site AS label FROM ps)"
    );
  }
  if (src.kind === "timeline") {
    return (
      "evr AS (\n" +
      "  SELECT DISTINCT p.stable_id AS pid, " + nameFoldSql("d.value") + " AS site, trimBoth(d.value) AS raw\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", src.eventType || "Diagnosis") + "\n" +
      "    AND " + foldedEqualsSql("d.key", src.key || "TUMOR_SITE") + " AND trimBoth(d.value) != ''\n" +
      "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
      "),\n" +
      "ev AS (SELECT DISTINCT pid, site FROM evr),\n" +
      "sl AS (SELECT site, min(raw) AS label FROM evr GROUP BY site),\n" +
      "ps AS (\n" +
      "  SELECT e.pid AS pid, s.site AS site, toUInt8((e.pid, s.site) IN (SELECT pid, site FROM ev)) AS has\n" +
      "  FROM (SELECT DISTINCT pid FROM ev) e CROSS JOIN (SELECT site FROM sl) s\n" +
      ")"
    );
  }
  const attr = orgAttr(src.attribute || "METASTATIC_SITE");
  return (
    "sm AS (\n" +
    "  SELECT DISTINCT " + pid + " AS pid, " + orgSiteMapSql("attribute_value") + " AS site\n" +
    "  FROM " + clinicalTable(db, [attr]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "sl AS (SELECT DISTINCT site, site AS label FROM sm),\n" +
    "ps AS (\n" +
    "  SELECT c.pid AS pid, s.site AS site, toUInt8((c.pid, s.site) IN (SELECT pid, site FROM sm)) AS has\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c CROSS JOIN (SELECT site FROM sl) s\n" +
    ")"
  );
}

/** Which site sources the cohort's patients carry: patients with a flag attribute (and how many
 *  flags), with a site on the timeline, and with a biopsy-site value. Counts only. */
export function orgSourcesSql(cohortSql: string, study: string, db: string, o: { prefix: string; eventType: string; key: string; attribute: string }): string {
  const pid = pidOf("patient_unique_id", study), prefix = orgAttr(o.prefix), attr = orgAttr(o.attribute);
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT\n" +
    "  (SELECT uniqExact(" + pid + ") FROM " + clinicalTable(db, []) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND startsWith(attribute_name, " + sq(prefix) + ") AND " + pid + " IN (SELECT pid FROM cohort)) AS flag_patients,\n" +
    "  (SELECT uniqExact(attribute_name) FROM " + clinicalTable(db, []) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND startsWith(attribute_name, " + sq(prefix) + ") AND " + pid + " IN (SELECT pid FROM cohort)) AS flags,\n" +
    "  (SELECT uniqExact(p.stable_id) FROM " + db + ".clinical_event ce\n" +
    "     JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
    "     JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "     JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "   WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", o.eventType) + " AND " + foldedEqualsSql("d.key", o.key) +
    " AND trimBoth(d.value) != '' AND p.stable_id IN (SELECT pid FROM cohort)) AS timeline_patients,\n" +
    "  (SELECT uniqExact(" + pid + ") FROM " + clinicalTable(db, [attr]) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != '' AND " + pid + " IN (SELECT pid FROM cohort)) AS sample_patients\n" +
    "FROM system.one"
  );
}

/** Per site: patients evaluable for it and those with a metastasis there. Counts only. */
export function orgSitesSql(cohortSql: string, study: string, db: string, src: OrgSource): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" + orgSiteCtes(study, db, src) + "\n" +
    "SELECT ps.site AS site, any(sl.label) AS label, count() AS evaluable, sum(ps.has) AS with_site\n" +
    "FROM ps INNER JOIN sl ON sl.site = ps.site GROUP BY site"
  );
}

/** Sample source: the biopsy-site values that ORG_SITE_MAP sends to "Other", with their patients. Counts only. */
export function orgOtherValuesSql(cohortSql: string, study: string, db: string, attribute: string): string {
  const pid = pidOf("patient_unique_id", study), attr = orgAttr(attribute);
  return (
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT trimBoth(attribute_value) AS value, uniqExact(" + pid + ") AS patients\n" +
    "FROM " + clinicalTable(db, [attr]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort) AND " + orgSiteMapSql("attribute_value") + " = 'Other'\n" +
    "GROUP BY value ORDER BY patients DESC, value LIMIT 30"
  );
}

export interface OrgGenes { genes: string[] | null; alteration: EnrichAlteration; driverPin: string | null }

/** `prof` (patient, gene) for every listed gene a patient's panel covers for the alteration type (whole-exome
 *  covers all); `alt` the same pairs with the alteration called on a covering panel (OncoKB drivers only with
 *  driverPin). Without a gene list, `alt` holds every gene. Both read `cohort`. */
function orgGeneCtes(study: string, db: string, g: OrgGenes): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study);
  const list = g.genes ? geneList(g.genes) : null;
  return (
    "pp AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[g.alteration]) + "\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (list
      ? "prof AS (\n" +
        "  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN (" + list + ")\n" +
        "  UNION DISTINCT\n" +
        "  SELECT pid, arrayJoin([" + list + "]) AS gene FROM pp WHERE panel = 'WES'\n" +
        "),\n"
      : "") +
    "alt AS (\n" +
    "  SELECT DISTINCT " + gPid + " AS pid, g.hugo_gene_symbol AS gene\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + (g.driverPin ? driverJoin(g.driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(g.alteration) + " AND NOT g.off_panel\n" +
    (list ? "    AND g.hugo_gene_symbol IN (" + list + ")\n" : "") + (g.driverPin ? "    AND ann.is_driver\n" : "") +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    ")"
  );
}

/** The cohort's most altered genes (patients with the alteration on a covering panel), at most `limit`. Counts only. */
export function orgTopGenesSql(cohortSql: string, study: string, db: string, g: Omit<OrgGenes, "genes">, limit: number): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, { ...g, genes: null }) + "\n" +
    "SELECT gene, count() AS altered FROM alt GROUP BY gene ORDER BY altered DESC, gene LIMIT " + Math.max(1, Math.min(200, Math.floor(limit)))
  );
}

/**
 * Per (site, gene, stratum): the patients evaluable for the site AND profiled for the gene, those
 * of them with a metastasis there, those altered, and those both — the four margins of one 2×2
 * per stratum (a patient's `stratifyBy` value; "Multiple" when their samples disagree, '' when none
 * is recorded). Counts only.
 */
export function orgCountsSql(cohortSql: string, study: string, db: string, src: OrgSource, g: OrgGenes & { genes: string[] }, stratifyBy: string | null): string {
  const pid = pidOf("patient_unique_id", study);
  const strat = stratifyBy ? orgAttr(stratifyBy) : null;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" + orgSiteCtes(study, db, src) + ",\n" + orgGeneCtes(study, db, g) + ",\n" +
    "st AS (\n" +
    (strat
      ? "  SELECT " + pid + " AS pid, if(uniqExact(" + clinicalValueFoldSql("attribute_value") + ") > 1, 'Multiple', any(trimBoth(attribute_value))) AS s\n" +
        "  FROM " + clinicalTable(db, [strat]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(strat) + " AND trimBoth(attribute_value) != ''\n" +
        "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid\n"
      : "  SELECT pid, '' AS s FROM cohort\n") +
    ")\n" +
    "SELECT ps.site AS site, prof.gene AS gene, st.s AS stratum, count() AS n, sum(ps.has) AS with_site,\n" +
    "       countIf(alt.pid != '') AS altered, countIf(ps.has = 1 AND alt.pid != '') AS both\n" +
    "FROM ps INNER JOIN prof ON prof.pid = ps.pid\n" +
    "  LEFT JOIN alt ON alt.pid = ps.pid AND alt.gene = prof.gene\n" +
    "  LEFT JOIN st ON st.pid = ps.pid\n" +
    "GROUP BY site, gene, stratum"
  );
}

/**
 * Cumulative incidence of the first timeline site event (src's event type, key = `siteValue`) with
 * death competing, for the cohort's patients profiled for `gene` and altered in it (`altered`) or
 * not: incidenceCountsSql over that half of the cohort. Counts only.
 */
export function orgIncidenceSql(cohortSql: string, study: string, db: string, src: OrgSource, g: OrgGenes & { genes: [string] }, altered: boolean, siteValue: string): string {
  const half = "SELECT pid FROM (" + cohortSql + ") WHERE pid IN (\n  WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, g) + "\n" +
    "  SELECT pid FROM prof)\n  AND pid " + (altered ? "" : "NOT ") + "IN (\n  WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, g) + "\n  SELECT pid FROM alt)";
  return incidenceCountsSql(half, study, db, { eventType: src.eventType || "Diagnosis", attrs: [{ key: src.key || "TUMOR_SITE", value: siteValue }] }, null);
}

// ---------------------------------------------------------------------------
// molsubtype: a published molecular classifier applied per patient

export interface MolMsiRule {
  attribute: string;
  /** a categorical MSI call: the values meaning MSI-high and those meaning stable (case-insensitive) */
  high?: string[]; stable?: string[];
  /** a numeric score: MSI-high at or above `threshold`, stable below `stableBelow`, in between indeterminate */
  threshold?: number; stableBelow?: number;
}
export interface MolEndometrialOpts {
  /** POLE exonuclease-domain hotspots (protein changes) */
  poleHotspots: string[];
  msi: MolMsiRule;
  /** an abnormal p53: an OncoKB-driver TP53 mutation at this pin, or (null) any non-synonymous TP53 mutation */
  p53Pin: string | null;
  /** a patient attribute to cross the subtypes with */
  by: string | null;
}

/** TP53 mutation classes counted as abnormal without OncoKB: protein-changing calls */
const MOL_TP53_CLASSES = ["Missense_Mutation", "Nonsense_Mutation", "Frame_Shift_Del", "Frame_Shift_Ins", "Splice_Site", "In_Frame_Del", "In_Frame_Ins", "Nonstop_Mutation", "Translation_Start_Site", "Splice_Region"];

/**
 * `cls`: each cohort patient's endometrial molecular class — the TCGA / ProMisE / WHO 2020 hierarchy,
 * first match wins: 'POLEmut' (a POLE hotspot called in any sample), 'MMRd' (MSI-high in any sample),
 * 'p53abn' (an abnormal TP53 mutation), 'NSMP' (none of these) — and 'NC' (not classifiable) with
 * `why` when an input the hierarchy needs before deciding is missing: not sequenced, not profiled for
 * POLE or TP53 (panel-aware), or no MSI value. Also `grp`, the `by` attribute per patient.
 */
function molEndometrialCtes(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study), pid = pidOf("patient_unique_id", study);
  const attr = orgAttr(o.msi.attribute);
  const hot = o.poleHotspots.map((h) => { if (!/^[A-Z][0-9]{1,5}[A-Z*]$/.test(h)) throw new Error("bad POLE hotspot '" + String(h).slice(0, 20) + "'"); return sq(h); }).join(", ");
  const v = clinicalValueFoldSql("attribute_value");
  const msiState = o.msi.threshold != null
    ? "multiIf(toFloat64OrNull(trimBoth(attribute_value)) IS NULL OR toFloat64OrNull(trimBoth(attribute_value)) < 0, 0, toFloat64OrNull(trimBoth(attribute_value)) >= " + Number(o.msi.threshold) +
      ", 2, toFloat64OrNull(trimBoth(attribute_value)) < " + Number(o.msi.stableBelow ?? o.msi.threshold) + ", 1, 0)"
    : "multiIf(" + v + " IN (" + (o.msi.high || []).map((x) => sq(x.trim().toLowerCase())).join(", ") + "), 2, " + v + " IN (" + (o.msi.stable || []).map((x) => sq(x.trim().toLowerCase())).join(", ") + "), 1, 0)";
  const by = o.by ? orgAttr(o.by) : null;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "pp AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED' AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "cov AS (\n" +
    "  SELECT pp.pid AS pid, max(pp.panel = 'WES' OR gp.gene = 'POLE') AS pole, max(pp.panel = 'WES' OR gp.gene = 'TP53') AS tp53\n" +
    "  FROM pp LEFT JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel AND gp.gene IN ('POLE', 'TP53')\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "mut AS (\n" +
    "  SELECT " + gPid + " AS pid,\n" +
    "         max(g.hugo_gene_symbol = 'POLE' AND g.mutation_variant IN (" + hot + ")) AS pole_hot,\n" +
    "         max(g.hugo_gene_symbol = 'TP53' AND " + (o.p53Pin ? "ann.is_driver" : "g.mutation_type IN (" + MOL_TP53_CLASSES.map(sq).join(", ") + ")") + ") AS p53\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + (o.p53Pin ? driverJoin(o.p53Pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'\n" +
    "    AND lowerUTF8(g.mutation_status) != 'germline' AND NOT g.off_panel AND g.hugo_gene_symbol IN ('POLE', 'TP53')\n" +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "msi AS (\n" +
    "  SELECT " + pid + " AS pid, max(" + msiState + ") AS m\n" +
    "  FROM " + clinicalTable(db, [attr]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "cls AS (\n" +
    "  SELECT c.pid AS pid,\n" +
    "         multiIf(cov.pid = '', 'NC', mut.pole_hot = 1, 'POLEmut', cov.pole = 0, 'NC', msi.m = 2, 'MMRd', msi.m = 0, 'NC', cov.tp53 = 0, 'NC', mut.p53 = 1, 'p53abn', 'NSMP') AS cls,\n" +
    "         multiIf(cov.pid = '', 'not sequenced', mut.pole_hot = 1, '', cov.pole = 0, 'not profiled for POLE', msi.m = 2, '', msi.m = 0, 'no MSI call', cov.tp53 = 0, 'not profiled for TP53', '') AS why\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c\n" +
    "  LEFT JOIN cov ON cov.pid = c.pid LEFT JOIN mut ON mut.pid = c.pid LEFT JOIN msi ON msi.pid = c.pid\n" +
    "),\n" +
    "grp AS (\n" +
    (by
      ? "  SELECT " + pid + " AS pid, if(uniqExact(" + v + ") > 1, 'Multiple', any(trimBoth(attribute_value))) AS g\n" +
        "  FROM " + clinicalTable(db, [by]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(by) + " AND trimBoth(attribute_value) != ''\n" +
        "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid\n"
      : "  SELECT pid, '' AS g FROM cohort\n") +
    ")"
  );
}

/** Patients per (class, why, group). Counts only. */
export function molCountsSql(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): string {
  return molEndometrialCtes(cohortSql, study, db, o) + "\n" +
    "SELECT cls.cls AS cls, cls.why AS why, grp.g AS grp, count() AS n FROM cls LEFT JOIN grp ON grp.pid = cls.pid GROUP BY cls, why, grp";
}

/** Overall survival per class: counts of (class, months, dead) from OS_MONTHS / OS_STATUS. Counts only. */
export function molSurvivalSql(cohortSql: string, study: string, db: string, o: MolEndometrialOpts): string {
  const pid = pidOf("patient_unique_id", study);
  return molEndometrialCtes(cohortSql, study, db, o) + ",\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid, toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) AS months,\n" +
    "         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT cls.cls AS cls, round(os.months, 2) AS t, os.dead AS dead, count() AS n\n" +
    "FROM cls INNER JOIN os ON os.pid = cls.pid WHERE os.months IS NOT NULL AND os.months >= 0 AND cls.cls != 'NC' GROUP BY cls, t, dead ORDER BY t";
}

/** Which MSI attributes the cohort's samples carry, with how many values and patients. Counts only. */
export function molMsiAttributesSql(cohortSql: string, study: string, db: string): string {
  const pid = pidOf("patient_unique_id", study);
  return "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT attribute_name AS attribute, uniqExact(" + pid + ") AS patients, uniqExact(attribute_value) AS nvalues, arraySort(groupUniqArray(8)(attribute_value)) AS examples\n" +
    "FROM " + clinicalTable(db, []) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND positionCaseInsensitive(attribute_name, 'MSI') > 0 AND trimBoth(attribute_value) != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "GROUP BY attribute ORDER BY patients DESC";
}
