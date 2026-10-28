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
binned AS (
  SELECT sid, chrom, bin, avg(m) AS v FROM (
    SELECT sid, chrom, m,
           arrayJoin(range(toUInt64(greatest(0, ceil((st - 1000000) / 2000000))),
                           toUInt64(greatest(0, floor((en - 1000000) / 2000000) + 1)))) AS bin
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en >= st
  ) GROUP BY sid, chrom, bin
)
SELECT chrom, bin, count() AS profiled, countIf(v >= 0.2) AS gain, countIf(v <= -0.2) AS loss
FROM binned GROUP BY chrom, bin ORDER BY chrom, bin

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
binned AS (
  SELECT sid, chrom, bin, avg(m) AS v FROM (
    SELECT sid, chrom, m,
           arrayJoin(range(toUInt64(greatest(0, ceil((st - 1000000) / 2000000))),
                           toUInt64(greatest(0, floor((en - 1000000) / 2000000) + 1)))) AS bin
    FROM seg WHERE chrom IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22') AND en >= st
  ) GROUP BY sid, chrom, bin
)
SELECT chrom, bin, count() AS profiled, countIf(v >= 0.2) AS gain, countIf(v <= -0.2) AS loss
FROM binned GROUP BY chrom, bin ORDER BY chrom, bin

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
