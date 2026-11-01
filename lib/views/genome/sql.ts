// The genome view's SQL: what its runner (run.ts) asks each participant's database for.
import { GENOME_CHROMS } from "../../federation-views.ts";
import { inCohortSamples, bareSampleId } from "../../cohort2.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

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
 *
 * Computed from segment runs, not from a row per (sample, bin): a sample's segments on a
 * chromosome are sorted, so most of a segment's bins belong to it alone and take its value. Each
 * segment's run of such bins becomes two events (+1 where the run starts, -1 where it ends), summed
 * along the chromosome; only the bins at a run's edges, which other segments of the sample also
 * cover, are averaged per sample. The work grows with the segments, not with samples x bins, which
 * held 262M groups in memory for a 175,000-sample cohort.
 */
export function genomeBinsSql(cohortSql: string, study: string, db: string, o: GenomeBinOpts): AggregateSql {
  const B = Math.max(1, Math.floor(o.binBp)), half = Math.floor(B / 2), T = Number(o.threshold);
  const chroms = "[" + GENOME_CHROMS.filter((c) => o.includeX || c !== "X").map(sq).join(",") + "]";
  // a run's events: +1 where it starts, -1 where it ends, for profiled and, by its value, gain or loss
  const delta = (cond: string) => "if(" + cond + ", e.2, toInt64(0))";
  const running = (col: string) => "sum(" + col + ") OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING)";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "samp AS (\n" +
    "  SELECT internal_id AS sid FROM " + db + ".sample_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + "\n" +
    "),\n" +
    "seg AS (\n" +
    "  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,\n" +
    "         s.start AS st, s.end AS en, s.segment_mean AS m\n" +
    "  FROM " + db + ".copy_number_seg s\n" +
    "  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study) + ")\n" +
    "    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)\n" +
    "),\n" +
    // each segment's bins [b0, b1), on chromosome c (its position in the list)
    "segs AS (\n" +
    "  SELECT sid, toUInt8(indexOf(" + chroms + ", chrom)) AS c, m, st,\n" +
    "         toUInt64(greatest(0, ceil((st - " + half + ") / " + B + "))) AS b0,\n" +
    "         toUInt64(greatest(0, floor((en - " + half + ") / " + B + ") + 1)) AS b1\n" +
    "  FROM seg WHERE has(" + chroms + ", chrom) AND en >= st\n" +
    "),\n" +
    // [p0, p1): the bins no other segment of the sample covers (none before ends past p0, none after starts before p1)
    "w AS (\n" +
    "  SELECT sid, c, m, b0, b1,\n" +
    "         greatest(b0, ifNull(maxOrNull(b1) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS p0,\n" +
    "         least(b1, ifNull(minOrNull(b0) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), b1)) AS p1\n" +
    "  FROM segs WHERE b1 > b0\n" +
    "),\n" +
    // the shared bins, averaged per sample as before
    "edges AS (\n" +
    "  SELECT c, bin, count() AS prof, countIf(v >= " + T + ") AS gain, countIf(v <= " + (-T) + ") AS loss FROM (\n" +
    "    SELECT sid, c, bin, avg(m) AS v FROM (\n" +
    "      SELECT sid, c, m, arrayJoin(if(p1 > p0, arrayConcat(range(b0, p0), range(p1, b1)), range(b0, b1))) AS bin FROM w\n" +
    "    ) GROUP BY sid, c, bin\n" +
    "  ) GROUP BY c, bin\n" +
    "),\n" +
    "deltas AS (\n" +
    "  SELECT c, pos, sum(d) AS dp, sum(dg) AS dgain, sum(dl) AS dloss FROM (\n" +
    "    SELECT c, arrayJoin([(p0, toInt64(1)), (p1, toInt64(-1))]) AS e, e.1 AS pos, e.2 AS d,\n" +
    "           " + delta("m >= " + T) + " AS dg, " + delta("m <= " + (-T)) + " AS dl FROM w WHERE p1 > p0\n" +
    "  ) GROUP BY c, pos\n" +
    "),\n" +
    // running totals at each event, holding until the next
    "runs AS (\n" +
    "  SELECT c, pos, ifNull(leadInFrame(pos) OVER (PARTITION BY c ORDER BY pos ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING), pos) AS nxt,\n" +
    "         " + running("dp") + " AS prof, " + running("dgain") + " AS gain, " + running("dloss") + " AS loss\n" +
    "  FROM deltas\n" +
    "),\n" +
    "inner_bins AS (\n" +
    "  SELECT c, arrayJoin(range(pos, greatest(pos, nxt))) AS bin, toUInt64(prof) AS prof, toUInt64(gain) AS gain, toUInt64(loss) AS loss\n" +
    "  FROM runs WHERE prof > 0\n" +
    ")\n" +
    "SELECT " + chroms + "[c] AS chrom, bin, sum(prof) AS profiled, sum(gain) AS gain, sum(loss) AS loss\n" +
    "FROM (SELECT * FROM edges UNION ALL SELECT * FROM inner_bins)\n" +
    "GROUP BY chrom, bin HAVING profiled > 0 ORDER BY chrom, bin"
  ));
}
