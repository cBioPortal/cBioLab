// Aggregate SQL for the view kinds in lib/views-more.ts. Same rules as every builder in
// lib/federation.ts, which re-exports these so test/boundary.test.ts sweeps them with the rest:
// the outer SELECT returns counts, sums and grouping keys — never an identifier — so any
// participant, aggregate-only included, can answer.
import { sq } from "./compiler.ts";
import { ALTERED_COND, driverJoin } from "./federation.ts";

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
