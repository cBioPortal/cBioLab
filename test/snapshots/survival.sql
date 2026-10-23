-- cohort MSI-H
-- ucec_msk_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type = 'sample'
    AND attribute_name = 'MSI_STATUS' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('MSI-H'))))

-- cohort MSS
-- ucec_msk_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type = 'sample'
    AND attribute_name = 'MSI_STATUS' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('MSS'))))

-- view 0 survival: survivalCounts:PFS_1L · ucec_msk_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type = 'sample'
    AND attribute_name = 'MSI_STATUS' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('MSI-H'))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid,
         anyIf(attribute_value, attribute_name='PFS_MONTHS_FIRST_LINE_TX') AS months,
         anyIf(attribute_value, attribute_name='PROGRESSION_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type='patient'
    AND attribute_name IN ('PFS_MONTHS_FIRST_LINE_TX','PROGRESSION_STATUS')
    AND replaceOne(patient_unique_id, 'ucec_msk_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 survival: survivalCounts:PFS_1L · ucec_msk_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type = 'sample'
    AND attribute_name = 'MSI_STATUS' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('MSS'))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'ucec_msk_2018_', '') AS pid,
         anyIf(attribute_value, attribute_name='PFS_MONTHS_FIRST_LINE_TX') AS months,
         anyIf(attribute_value, attribute_name='PROGRESSION_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'ucec_msk_2018' AND type='patient'
    AND attribute_name IN ('PFS_MONTHS_FIRST_LINE_TX','PROGRESSION_STATUS')
    AND replaceOne(patient_unique_id, 'ucec_msk_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m
