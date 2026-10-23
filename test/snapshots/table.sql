-- cohort Pancreatic
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))

-- view 0 table: table:attributes · msk_chord_2024
SELECT m.attr_id AS id, m.display_name AS name, m.datatype AS datatype, m.patient_attribute AS patient, toInt32OrZero(m.priority) AS priority
FROM snapshot_db.clinical_attribute_meta m
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = m.cancer_study_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'
ORDER BY priority DESC, name

-- view 0 table: table:counts · msk_chord_2024
WITH c0 AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))),
u0 AS (
  SELECT patient_unique_id AS puid, sample_unique_id AS suid, 1 AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
),
pv0 AS (
  SELECT patient_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('CURRENT_AGE_DEID')
    AND attribute_value != '' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY k
),
sv0 AS (
  SELECT sample_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND 0
    AND attribute_value != '' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY k
),
rows AS (
  SELECT 'Pancreatic' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         replaceOne(u.puid, 'msk_chord_2024_', '') AS patient, replaceOne(u.suid, 'msk_chord_2024_', '') AS sample, u.samples AS samples, mapUpdate(pv.m, sv.m) AS m
  FROM u0 AS u LEFT JOIN pv0 AS pv ON pv.k = u.puid LEFT JOIN sv0 AS sv ON sv.k = u.suid
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 table: table:rows · msk_chord_2024
WITH c0 AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))),
u0 AS (
  SELECT patient_unique_id AS puid, sample_unique_id AS suid, 1 AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
),
pv0 AS (
  SELECT patient_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_STATUS','RACE','GENDER','STAGE_HIGHEST_RECORDED','ETHNICITY','CURRENT_AGE_DEID','SMOKING_PREDICTIONS_3_CLASSES','PRIOR_MED_TO_MSK','GLEASON_HIGHEST_REPORTED','HISTORY_OF_PDL1','NUM_ICDO_DX','SAMPLE_COUNT','GLEASON_FIRST_REPORTED','HER2','HR','OS_MONTHS','ADRENAL_GLANDS','BONE','CNS_BRAIN','INTRA_ABDOMINAL','LIVER','LUNG','LYMPH_NODES','OTHER','PLEURA','REPRODUCTIVE_ORGANS')
    AND attribute_value != '' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY k
),
sv0 AS (
  SELECT sample_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE','CLINICAL_GROUP','CLINICAL_SUMMARY','DIAGNOSIS_DESCRIPTION','ICD_O_HISTOLOGY_DESCRIPTION','PATHOLOGICAL_GROUP','CANCER_TYPE_DETAILED','SAMPLE_TYPE','MSI_TYPE','GENE_PANEL','SOMATIC_STATUS','SAMPLE_CLASS','MUTATION_COUNT','FRACTION_GENOME_ALTERED','TMB_NONSYNONYMOUS','GLEASON_SAMPLE_LEVEL','MSI_COMMENT','MSI_SCORE','METASTATIC_SITE','ONCOTREE_CODE','PRIMARY_SITE','PDL1_POSITIVE','SAMPLE_COVERAGE','TUMOR_PURITY')
    AND attribute_value != '' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY k
),
rows AS (
  SELECT 'Pancreatic' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         replaceOne(u.puid, 'msk_chord_2024_', '') AS patient, replaceOne(u.suid, 'msk_chord_2024_', '') AS sample, u.samples AS samples, mapUpdate(pv.m, sv.m) AS m
  FROM u0 AS u LEFT JOIN pv0 AS pv ON pv.k = u.puid LEFT JOIN sv0 AS sv ON sv.k = u.suid
)
SELECT cohort, study, patient, sample, samples, m, count() OVER () AS total FROM rows
WHERE 1
ORDER BY if(isFinite(ifNull(toFloat64OrNull(m['CURRENT_AGE_DEID']), nan)), toFloat64OrNull(m['CURRENT_AGE_DEID']), NULL) DESC NULLS LAST, patient, sample, ord
LIMIT 25 OFFSET 0
