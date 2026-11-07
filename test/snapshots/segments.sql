-- cohort IM-GBM-28
-- glioma_msk_2018
(SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT DISTINCT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN ('IM-GBM-28')))

-- view 0 segments: genome:build · glioma_msk_2018
SELECT rg.name AS build FROM snapshot_db.cancer_study cs
JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
WHERE cs.cancer_study_identifier = 'glioma_msk_2018'

-- view 0 segments: segments:samples:IM-GBM-28 · glioma_msk_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT DISTINCT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN ('IM-GBM-28')))),
samp AS (
  SELECT internal_id AS sid, sample_stable_id AS sample, patient_stable_id AS patient, sample_type AS stype FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(sample_unique_id, 'glioma_msk_2018_', '') IN (SELECT sid FROM cohort)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', s.chr IN ('24', 'Y', 'chrY'), 'Y', replaceOne(s.chr, 'chr', '')) AS chrom, s.start AS st, s.end AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'glioma_msk_2018')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
)
,
per AS (
  SELECT sid, countIf(has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom)) AS segs, countIf(NOT has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom)) AS other,
         sumIf(m * (en - st + 1), has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom)) AS wsum, sumIf((en - st + 1), has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom)) AS wlen
  FROM seg GROUP BY sid
)
SELECT p.sid AS sid, samp.sample AS sample, samp.patient AS patient, samp.stype AS stype, p.segs AS segs,
       if(p.wlen > 0, p.wsum / p.wlen, NULL) AS score,
       count() OVER () AS segmented, sum(p.other) OVER () AS otherChrom
FROM per p JOIN samp ON samp.sid = p.sid
ORDER BY sid
LIMIT 300

-- view 0 segments: segments:segments:IM-GBM-28 · glioma_msk_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT DISTINCT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'
    AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN ('IM-GBM-28')))),
samp AS (
  SELECT internal_id AS sid, sample_stable_id AS sample, patient_stable_id AS patient, sample_type AS stype FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(sample_unique_id, 'glioma_msk_2018_', '') IN (SELECT sid FROM cohort) AND internal_id IN (47601,47603,47602,47600)
),
seg AS (
  SELECT s.sample_id AS sid, multiIf(s.chr IN ('23', 'X', 'chrX'), 'X', s.chr IN ('24', 'Y', 'chrY'), 'Y', replaceOne(s.chr, 'chr', '')) AS chrom, s.start AS st, s.end AS en, s.segment_mean AS m
  FROM snapshot_db.copy_number_seg s
  WHERE s.cancer_study_id = (SELECT cancer_study_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'glioma_msk_2018')
    AND s.sample_id IN (SELECT sid FROM samp) AND isFinite(s.segment_mean)
)
SELECT sid, indexOf(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom) - 1 AS c, st, en, m FROM seg
WHERE has(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','X','Y'], chrom)
ORDER BY sid, c, st, en

-- view 0 segments: timeline:events · glioma_msk_2018
WITH pt AS (
  SELECT p.internal_id FROM snapshot_db.patient p JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'glioma_msk_2018' AND p.stable_id = 'IM-GBM-28'
), ev AS (
  SELECT clinical_event_id, event_type, start_date, stop_date FROM snapshot_db.clinical_event WHERE patient_id IN (SELECT internal_id FROM pt)
)
SELECT ev.clinical_event_id AS id, ev.event_type AS type, ev.start_date AS start, ev.stop_date AS stop,
       groupArrayIf((d.key, d.value), d.key != '') AS attrs
FROM ev LEFT JOIN (
  SELECT clinical_event_id, key, value FROM snapshot_db.clinical_event_data WHERE clinical_event_id IN (SELECT clinical_event_id FROM ev)
) d ON d.clinical_event_id = ev.clinical_event_id
GROUP BY id, type, start, stop
ORDER BY start, id

-- view 0 segments: timeline:samples · glioma_msk_2018
SELECT replaceOne(s.sample_unique_id, 'glioma_msk_2018_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'glioma_msk_2018' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'glioma_msk_2018' AND s.patient_unique_id = 'glioma_msk_2018_IM-GBM-28'
GROUP BY id ORDER BY id
