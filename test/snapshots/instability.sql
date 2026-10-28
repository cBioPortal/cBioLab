-- cohort Colorectal
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))

-- cohort Breast
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))

-- cohort Pancreatic
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))))

-- view 0 instability: instability:arms:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT arm, countIf(measured) AS n_measured, countIf(measured AND gain) AS n_gain, countIf(measured AND loss) AS n_loss FROM calls GROUP BY arm

-- view 0 instability: instability:arms:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT arm, countIf(measured) AS n_measured, countIf(measured AND gain) AS n_gain, countIf(measured AND loss) AS n_loss FROM calls GROUP BY arm

-- view 0 instability: instability:arms:Pancreatic · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT arm, countIf(measured) AS n_measured, countIf(measured AND gain) AS n_gain, countIf(measured AND loss) AS n_loss FROM calls GROUP BY arm

-- view 0 instability: instability:build · msk_impact_50k_2026
SELECT rg.name AS build FROM snapshot_db.cancer_study cs
JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 instability: instability:coverage:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
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

-- view 0 instability: instability:coverage:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
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

-- view 0 instability: instability:coverage:Pancreatic · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
)
SELECT (SELECT count() FROM samp) AS samples,
       (SELECT uniqExact(sample_id) FROM snapshot_db.copy_number_seg
         WHERE cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
           AND sample_id IN (SELECT sid FROM samp)) AS segmented
FROM system.one

-- view 0 instability: instability:scores:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT toInt32(least(100, floor(100 * alt / greatest(1, cov)))) AS fga_bin, score, measured, count() AS n
FROM per GROUP BY fga_bin, score, measured ORDER BY fga_bin, score

-- view 0 instability: instability:scores:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT toInt32(least(100, floor(100 * alt / greatest(1, cov)))) AS fga_bin, score, measured, count() AS n
FROM per GROUP BY fga_bin, score, measured ORDER BY fga_bin, score

-- view 0 instability: instability:scores:Pancreatic · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))))),
samp AS (
  SELECT internal_id AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', replaceOne(s.chr, 'chr', '')) AS chrom,
         toInt64(s.start) AS st, toInt64(s.end) AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_impact_50k_2026')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
),
parts AS (
  SELECT sid, chrom, m, arm, greatest(toInt64(0), least(en, hi) - greatest(st, lo)) AS bp, hi - lo AS arm_len FROM (
    SELECT sid, chrom, m, st, en, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [125000000,93300000,91000000,50400000,48400000,61000000,59900000,45600000,49000000,40200000,53700000,35800000,17900000,17600000,19000000,36600000,24000000,17200000,26500000,27500000,13200000,14700000], 0) AS c, transform(chrom, ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22'], [249250621,243199373,198022430,191154276,180915260,171115067,159138663,146364022,141213431,135534747,135006516,133851895,115169878,107349540,102531392,90354753,81195210,78077248,59128983,63025520,48129895,51304566], 0) AS l,
           arrayJoin([(concat(chrom, 'p'), toInt64(0), toInt64(c)), (concat(chrom, 'q'), toInt64(c), toInt64(l))]) AS a,
           a.1 AS arm, a.2 AS lo, a.3 AS hi
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en > st
  ) WHERE NOT (arm IN ('13p','14p','15p','21p','22p'))
),
arms AS (
  SELECT sid, arm, any(arm_len) AS alen, sum(bp) AS cov, sumIf(bp, m >= 0.2) AS gbp, sumIf(bp, m <= -0.2) AS lbp
  FROM parts GROUP BY sid, arm
),
calls AS (
  SELECT sid, arm, cov >= 0.5 * alen AS measured, gbp > 0.5 * alen AS gain, lbp > 0.5 * alen AS loss FROM arms
),
per AS (
  SELECT a.sid AS sid, sum(a.cov) AS cov, sum(a.gbp + a.lbp) AS alt,
         countIf(c.gain OR c.loss) AS score, countIf(c.measured) AS measured
  FROM arms a INNER JOIN calls c ON c.sid = a.sid AND c.arm = a.arm GROUP BY a.sid
)
SELECT toInt32(least(100, floor(100 * alt / greatest(1, cov)))) AS fga_bin, score, measured, count() AS n
FROM per GROUP BY fga_bin, score, measured ORDER BY fga_bin, score
