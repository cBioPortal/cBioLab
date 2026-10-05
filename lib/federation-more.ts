// Aggregate SQL for the view kinds in lib/views-more.ts. Same rules as every builder in
// lib/federation.ts, which re-exports these so test/boundary.test.ts sweeps them with the rest:
// the outer SELECT returns counts, sums and grouping keys — never an identifier — so any
// participant, aggregate-only included, can answer.
import { sq } from "./compiler.ts";
import { ALTERED_COND, driverJoin } from "./federation.ts";
import { clinicalValueFoldSql, nameFoldSql, foldedEqualsSql } from "./event-names.ts";
import { clinicalTable } from "./custom-data.ts";

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
  const raw = "toFloat64OrNull(ga.alteration_value)";
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
  const scan = genes == null;
  const geneList = scan ? "SELECT DISTINCT gene FROM alt" : genes.map(sq).join(",");
  const hit = measure === "driver" ? "max(ann.is_driver)" : "1";
  return (
    pairedSidesCtes(cohortSql, study, db, by) + ",\n" +
    "alt AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, " + (pin || measure === "any" ? hit : "0") + " AS hit\n" +
    "  FROM " + db + ".genomic_event_derived g\n" +
    (pin && measure === "driver" ? driverJoin(pin) : "") +
    "  INNER JOIN ps ON ps.suid = g.sample_unique_id\n" +
    "  WHERE g.cancer_study_identifier = " + sq(study) + (scan ? "" : " AND g.hugo_gene_symbol IN (" + geneList + ")") + " AND " + ALTERED_COND + "\n" +
    // narrows the events before the annotation join rather than after it
    "    AND g.sample_unique_id IN (SELECT suid FROM ps)\n" +
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
    "       toInt32(floor(least(if(attribute_name = 'FACETS_PURITY', 0.9999, 7.9999), greatest(0, toFloat64OrNull(attribute_value))) /\n" +
    "         if(attribute_name = 'FACETS_PURITY', 0.05, 0.25))) AS bin,\n" +
    "       count() AS n\n" +
    "FROM " + clinicalTable(db, ["FACETS_PURITY", "FACETS_PLOIDY"]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name IN ('FACETS_PURITY', 'FACETS_PLOIDY')\n" +
    "  AND sample_unique_id IN (SELECT suid FROM samp) AND toFloat64OrNull(attribute_value) IS NOT NULL\n" +
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
    "         toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')) AS months,\n" +
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
    "  SELECT p.stable_id AS pid, ce.start_date AS day, toFloat64OrNull(r.value) AS v\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", lab.testKey) + " AND " + foldedEqualsSql("t.value", lab.test) + "\n" +
    "  JOIN " + db + ".clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("r.key", lab.resultKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", lab.eventType) + "\n" +
    "    AND p.stable_id IN (SELECT pid FROM anch) AND toFloat64OrNull(r.value) IS NOT NULL\n" +
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
 * waterfall. Patient-level: only PatientLevelResolver.moreRows runs it, the same entitlement
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
  const raw = "toFloat64OrNull(ga.alteration_value)";
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
