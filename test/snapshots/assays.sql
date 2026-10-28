-- cohort Melanoma
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))

-- cohort Non-small cell lung
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))

-- view 0 assays: assays:moments:Melanoma · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))),
rows AS (
  SELECT entity_stable_id AS entity, value FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'mutational_signatures_contribution_v2'
    AND profile_stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2'
    AND if(ifNull(patient_level, 0) = 1, replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort), replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort))
)
SELECT entity, countIf(isFinite(toFloat64OrNull(value))) AS n,
       sumIf(toFloat64OrNull(value), isFinite(toFloat64OrNull(value))) AS sx,
       sumIf(pow(toFloat64OrNull(value), 2), isFinite(toFloat64OrNull(value))) AS sxx,
       countIf(NOT isFinite(ifNull(toFloat64OrNull(value), nan))) AS other
FROM rows GROUP BY entity

-- view 0 assays: assays:moments:Non-small cell lung · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
rows AS (
  SELECT entity_stable_id AS entity, value FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'mutational_signatures_contribution_v2'
    AND profile_stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2'
    AND if(ifNull(patient_level, 0) = 1, replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort), replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort))
)
SELECT entity, countIf(isFinite(toFloat64OrNull(value))) AS n,
       sumIf(toFloat64OrNull(value), isFinite(toFloat64OrNull(value))) AS sx,
       sumIf(pow(toFloat64OrNull(value), 2), isFinite(toFloat64OrNull(value))) AS sxx,
       countIf(NOT isFinite(ifNull(toFloat64OrNull(value), nan))) AS other
FROM rows GROUP BY entity

-- view 0 assays: assays:names · msk_impact_50k_2026
WITH named AS (
  SELECT ge.stable_id AS entity, p.value AS name FROM snapshot_db.generic_entity_properties p
  JOIN snapshot_db.genetic_entity ge ON ge.id = p.genetic_entity_id
  WHERE p.name = 'NAME' AND ge.stable_id IN (SELECT DISTINCT entity_stable_id FROM snapshot_db.generic_assay_data_derived
    WHERE profile_type = 'mutational_signatures_contribution_v2' AND profile_stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2')
)
SELECT entity, name FROM named

-- view 0 assays: assays:profile · msk_impact_50k_2026
SELECT datatype, generic_assay_type, ifNull(patient_level, 0) AS patient_level, name FROM snapshot_db.genetic_profile
WHERE stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2' AND genetic_alteration_type = 'GENERIC_ASSAY'
