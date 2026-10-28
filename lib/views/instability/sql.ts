// The instability view's SQL: what its runner (run.ts) asks each participant's database for.
import { GENOME_CHROMS, CHROM_LENGTHS } from "../../federation-views.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** the arms scored: 39 autosomal arms (and Xp, Xq with includeX), in genome order */
export function instabilityArms(includeX: boolean): string[] {
  return GENOME_CHROMS.filter((c) => includeX || c !== "X").flatMap((c) => ACROCENTRIC.includes(c) ? [c + "q"] : [c + "p", c + "q"]);
}

/** FGA in 1-point bins × aneuploidy score, with how many arms each sample had measured: counts of samples. */
export function instabilityScoresSql(cohortSql: string, study: string, db: string, o: InstabilityOpts): AggregateSql {
  return aggregateSql((
    instabilityCtes(cohortSql, study, db, o) + "\n" +
    "SELECT toInt32(least(100, floor(100 * alt / greatest(1, cov)))) AS fga_bin, score, measured, count() AS n\n" +
    "FROM per GROUP BY fga_bin, score, measured ORDER BY fga_bin, score"
  ));
}

/** Per arm: the samples that measured it, and those with it gained or lost. */
export function instabilityArmsSql(cohortSql: string, study: string, db: string, o: InstabilityOpts): AggregateSql {
  return aggregateSql((
    instabilityCtes(cohortSql, study, db, o) + "\n" +
    "SELECT arm, countIf(measured) AS n_measured, countIf(measured AND gain) AS n_gain, countIf(measured AND loss) AS n_loss FROM calls GROUP BY arm"
  ));
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
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
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
