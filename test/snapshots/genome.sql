-- cohort Colorectal
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))

-- cohort Breast
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))

-- view 0 genome: genome:bins:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         s.start AS st, s.end AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
segs AS (
  SELECT sid, toUInt8(indexOf(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], chrom)) AS c, m, st,
         toUInt64(greatest(0, ceil((st - 1000000) / 2000000))) AS b0,
         toUInt64(greatest(0, floor((en - 1000000) / 2000000) + 1)) AS b1
  FROM seg WHERE has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], chrom) AND en >= st
),
w AS (
  SELECT sid, c, m, b0, b1,
         greatest(b0, ifNull(maxOrNull(b1) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS p0,
         least(b1, ifNull(minOrNull(b0) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), b1)) AS p1
  FROM segs WHERE b1 > b0
),
edges AS (
  SELECT c, bin, count() AS prof, countIf(v >= 0.2) AS gain, countIf(v <= -0.2) AS loss FROM (
    SELECT sid, c, bin, avg(m) AS v FROM (
      SELECT sid, c, m, arrayJoin(if(p1 > p0, arrayConcat(range(b0, p0), range(p1, b1)), range(b0, b1))) AS bin FROM w
    ) GROUP BY sid, c, bin
  ) GROUP BY c, bin
),
deltas AS (
  SELECT c, pos, sum(d) AS dp, sum(dg) AS dgain, sum(dl) AS dloss FROM (
    SELECT c, arrayJoin([(p0, toInt64(1)), (p1, toInt64(-1))]) AS e, e.1 AS pos, e.2 AS d,
           if(m >= 0.2, e.2, toInt64(0)) AS dg, if(m <= -0.2, e.2, toInt64(0)) AS dl FROM w WHERE p1 > p0
  ) GROUP BY c, pos
),
runs AS (
  SELECT c, pos, ifNull(leadInFrame(pos) OVER (PARTITION BY c ORDER BY pos ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING), pos) AS nxt,
         sum(dp) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS prof, sum(dgain) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS gain, sum(dloss) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS loss
  FROM deltas
),
inner_bins AS (
  SELECT c, arrayJoin(range(pos, greatest(pos, nxt))) AS bin, toUInt64(prof) AS prof, toUInt64(gain) AS gain, toUInt64(loss) AS loss
  FROM runs WHERE prof > 0
)
SELECT ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'][c] AS chrom, bin, sum(prof) AS profiled, sum(gain) AS gain, sum(loss) AS loss
FROM (SELECT * FROM edges UNION ALL SELECT * FROM inner_bins)
GROUP BY chrom, bin HAVING profiled > 0 ORDER BY chrom, bin

-- view 0 genome: genome:bins:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         s.start AS st, s.end AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
segs AS (
  SELECT sid, toUInt8(indexOf(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], chrom)) AS c, m, st,
         toUInt64(greatest(0, ceil((st - 1000000) / 2000000))) AS b0,
         toUInt64(greatest(0, floor((en - 1000000) / 2000000) + 1)) AS b1
  FROM seg WHERE has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], chrom) AND en >= st
),
w AS (
  SELECT sid, c, m, b0, b1,
         greatest(b0, ifNull(maxOrNull(b1) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS p0,
         least(b1, ifNull(minOrNull(b0) OVER (PARTITION BY sid, c ORDER BY st, b0, b1 ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), b1)) AS p1
  FROM segs WHERE b1 > b0
),
edges AS (
  SELECT c, bin, count() AS prof, countIf(v >= 0.2) AS gain, countIf(v <= -0.2) AS loss FROM (
    SELECT sid, c, bin, avg(m) AS v FROM (
      SELECT sid, c, m, arrayJoin(if(p1 > p0, arrayConcat(range(b0, p0), range(p1, b1)), range(b0, b1))) AS bin FROM w
    ) GROUP BY sid, c, bin
  ) GROUP BY c, bin
),
deltas AS (
  SELECT c, pos, sum(d) AS dp, sum(dg) AS dgain, sum(dl) AS dloss FROM (
    SELECT c, arrayJoin([(p0, toInt64(1)), (p1, toInt64(-1))]) AS e, e.1 AS pos, e.2 AS d,
           if(m >= 0.2, e.2, toInt64(0)) AS dg, if(m <= -0.2, e.2, toInt64(0)) AS dl FROM w WHERE p1 > p0
  ) GROUP BY c, pos
),
runs AS (
  SELECT c, pos, ifNull(leadInFrame(pos) OVER (PARTITION BY c ORDER BY pos ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING), pos) AS nxt,
         sum(dp) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS prof, sum(dgain) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS gain, sum(dloss) OVER (PARTITION BY c ORDER BY pos ROWS UNBOUNDED PRECEDING) AS loss
  FROM deltas
),
inner_bins AS (
  SELECT c, arrayJoin(range(pos, greatest(pos, nxt))) AS bin, toUInt64(prof) AS prof, toUInt64(gain) AS gain, toUInt64(loss) AS loss
  FROM runs WHERE prof > 0
)
SELECT ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'][c] AS chrom, bin, sum(prof) AS profiled, sum(gain) AS gain, sum(loss) AS loss
FROM (SELECT * FROM edges UNION ALL SELECT * FROM inner_bins)
GROUP BY chrom, bin HAVING profiled > 0 ORDER BY chrom, bin

-- view 0 genome: genome:build · msk_impact_50k_2026
SELECT rg.name AS build FROM snapshot_db.cancer_study cs
JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 genome: genome:coverage:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
)
SELECT (SELECT count() FROM samp) AS samples,
       (SELECT uniqExact(sample_id) FROM snapshot_db.copy_number_seg
         WHERE cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
           AND sample_id IN (SELECT sid FROM samp)) AS segmented
FROM system.one

-- view 0 genome: genome:coverage:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
)
SELECT (SELECT count() FROM samp) AS samples,
       (SELECT uniqExact(sample_id) FROM snapshot_db.copy_number_seg
         WHERE cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
           AND sample_id IN (SELECT sid FROM samp)) AS segmented
FROM system.one
