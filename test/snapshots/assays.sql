-- cohort Melanoma
-- msk_impact_50k_2026
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))

-- cohort Non-small cell lung
-- msk_impact_50k_2026
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))

-- view 0 assays: assays:moments:Melanoma · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))),
rows AS (
  SELECT entity_stable_id AS entity, value FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'mutational_signatures_contribution_v2'
    AND profile_stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2'
    AND patient_unique_id IN (SELECT concat('msk_impact_50k_2026_', pid) FROM cohort)
)
SELECT entity, countIf(isFinite(toFloat64OrNull(value))) AS n,
       sumIf(toFloat64OrNull(value), isFinite(toFloat64OrNull(value))) AS sx,
       sumIf(pow(toFloat64OrNull(value), 2), isFinite(toFloat64OrNull(value))) AS sxx,
       countIf(NOT isFinite(ifNull(toFloat64OrNull(value), nan))) AS other
FROM rows GROUP BY entity

-- view 0 assays: assays:moments:Non-small cell lung · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
rows AS (
  SELECT entity_stable_id AS entity, value FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'mutational_signatures_contribution_v2'
    AND profile_stable_id = 'msk_impact_50k_2026_mutational_signatures_contribution_v2'
    AND patient_unique_id IN (SELECT concat('msk_impact_50k_2026_', pid) FROM cohort)
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
