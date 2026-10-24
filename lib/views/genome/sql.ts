// The genome view's SQL: what its runner (run.ts) asks each participant's database for.
import { GENOME_CHROMS, pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";

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
